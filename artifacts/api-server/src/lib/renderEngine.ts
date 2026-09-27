/**
 * renderEngine — Real Render Pipeline
 *
 * Hard rules (Task 58341):
 *  - No pipe:0 without stdin
 *  - No mozilla.net / flower.mp4 / demo / placeholder assets
 *  - Every clip MUST resolve to a real file on disk or a download-able http(s) URL
 *  - FFmpeg via spawn with real files
 *  - ffprobe verify: video stream + duration > 0 + size > 0
 *  - Status transitions: QUEUED → PROCESSING → COMPLETED | FAILED
 *  - outputPath + outputUrl valid on COMPLETED
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, renderJobsTable, type RenderJobRow, type RenderStatus } from "@workspace/db";

const pExec = promisify(execFile);

const RENDERS_DIR = path.resolve(process.cwd(), "uploads", "renders");
const TEMP_ASSETS_DIR = path.resolve(process.cwd(), "uploads", "temp", "render_assets");
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500MB

// ---------- forbidden patterns (defensive) ----------
const FORBIDDEN_ASSET_PATTERNS = [
  /mozilla\.net/i,
  /flower\.mp4/i,
  /interactive-examples/i,
  /sample-videos/i,
  /w3schools/i,
];

export interface RenderClipInput {
  id: string | number;
  assetUrl: string;
  durationSeconds: number;
  order: number;
  sourceStart?: number;
  sourceEnd?: number;
}

export interface CreateRenderJobInput {
  projectId: number;
  clips: RenderClipInput[];
  /** REQUIRED real audio asset (VOICE track). Local /uploads/... path or http(s) URL.
   *  Silent fallback is FORBIDDEN in production — passing empty/null will fail loudly. */
  audioUrl: string;
  watermarkText?: string;
  subtitlesText?: string;
}

export interface RenderJobStatus {
  id: string;
  projectId: number;
  status: RenderStatus;
  progress: number;
  outputPath: string | null;
  outputUrl: string | null;
  duration: number | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
}

// ================================================================
// Create / Read
// ================================================================

export async function createRenderJob(input: CreateRenderJobInput): Promise<RenderJobStatus> {
  if (!input || typeof input.projectId !== "number" || !Number.isFinite(input.projectId)) {
    throw new Error("createRenderJob: valid projectId is required");
  }
  if (!Array.isArray(input.clips) || input.clips.length === 0) {
    throw new Error("createRenderJob: at least one clip is required (no placeholder clips allowed)");
  }
  // ── Silent audio fallback is forbidden ──
  if (typeof input.audioUrl !== "string" || input.audioUrl.trim().length === 0) {
    throw new Error(
      "Real audio asset missing: audioUrl is required for production render. " +
      "Silent audio fallback (anullsrc / silent MP4) is disabled in production. " +
      "Provide a real VOICE track asset URL."
    );
  }
  for (let i = 0; i < input.clips.length; i++) {
    const c = input.clips[i];
    if (!c || typeof c.assetUrl !== "string" || c.assetUrl.trim() === "") {
      throw new Error(`createRenderJob: clip #${i + 1} has no assetUrl`);
    }
    for (const pat of FORBIDDEN_ASSET_PATTERNS) {
      if (pat.test(c.assetUrl)) {
        throw new Error(`createRenderJob: clip #${i + 1} references a forbidden placeholder asset (${c.assetUrl})`);
      }
    }
  }

  const [row] = await db
    .insert(renderJobsTable)
    .values({
      projectId: input.projectId,
      status: "QUEUED",
      input: {
        clips: input.clips,
        audioUrl: input.audioUrl ?? null,
        watermarkText: input.watermarkText ?? null,
        subtitlesText: input.subtitlesText ?? null,
      },
    })
    .returning();

  return toStatus(row!);
}

export async function getRenderJobStatus(jobId: string): Promise<RenderJobStatus | null> {
  const rows = await db.select().from(renderJobsTable).where(eq(renderJobsTable.id, jobId)).limit(1);
  const row = rows[0];
  return row ? toStatus(row) : null;
}

function toStatus(row: RenderJobRow): RenderJobStatus {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as RenderStatus,
    progress: progressForStatus(row.status as RenderStatus),
    outputPath: row.outputPath ?? null,
    outputUrl: row.outputUrl ?? null,
    duration: row.duration ?? null,
    sizeBytes: row.sizeBytes ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function progressForStatus(s: RenderStatus): number {
  switch (s) {
    case "QUEUED": return 0;
    case "PROCESSING": return 50;
    case "COMPLETED": return 100;
    case "FAILED": return 0;
  }
}

// ================================================================
// Asset resolution
// ================================================================

/**
 * Resolve an asset source (local path or http(s) URL) to a real local file.
 * Throws on any failure. Never returns a placeholder.
 */
async function resolveAssetToLocal(source: string): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("resolveAssetToLocal: empty source");

  for (const pat of FORBIDDEN_ASSET_PATTERNS) {
    if (pat.test(trimmed)) {
      throw new Error(`resolveAssetToLocal: forbidden placeholder source: ${trimmed}`);
    }
  }

  // 1. Local path (absolute or /uploads/... or relative)
  if (trimmed.startsWith("/uploads/")) {
    const abs = path.resolve(process.cwd(), trimmed.replace(/^\//, ""));
    return verifyLocalFile(abs, trimmed);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const abs = path.resolve(process.cwd(), trimmed);
    return verifyLocalFile(abs, trimmed);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    // Try as a project-relative path
    const abs = path.resolve(process.cwd(), trimmed);
    if (fs.existsSync(abs)) return verifyLocalFile(abs, trimmed);
    throw new Error(`resolveAssetToLocal: source is not a URL or an existing local file: ${trimmed}`);
  }

  // 2. http(s) URL → download safely
  return downloadToTemp(trimmed);
}

function verifyLocalFile(abs: string, original: string): string {
  if (!fs.existsSync(abs)) {
    throw new Error(`resolveAssetToLocal: file not found: ${original} → ${abs}`);
  }
  const st = fs.statSync(abs);
  if (!st.isFile() || st.size === 0) {
    throw new Error(`resolveAssetToLocal: file is not a valid non-empty file: ${abs} (size=${st.size})`);
  }
  return abs;
}

function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error(`downloadToTemp: malformed URL: ${url}`));
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reject(new Error(`downloadToTemp: unsupported protocol: ${parsed.protocol}`));
    }
    // SSRF guard
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
        host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("169.254.")) {
      return reject(new Error(`downloadToTemp: refused to fetch internal host: ${host}`));
    }

    fs.mkdirSync(TEMP_ASSETS_DIR, { recursive: true });
    const ext = path.extname(parsed.pathname) || ".mp4";
    const localName = `dl_${randomUUID()}${ext}`;
    const localPath = path.join(TEMP_ASSETS_DIR, localName);

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow one redirect
        res.resume();
        const redir = new URL(res.headers.location, url).toString();
        return downloadToTemp(redir).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`downloadToTemp: HTTP ${res.statusCode} for ${url}`));
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) {
          req.destroy();
          return reject(new Error(`downloadToTemp: download exceeds ${MAX_DOWNLOAD_BYTES} bytes`));
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) return reject(new Error(`downloadToTemp: empty body from ${url}`));
        fs.writeFileSync(localPath, buf);
        resolve(localPath);
      });
      res.on("error", (e) => reject(new Error(`downloadToTemp: stream error: ${e.message}`)));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error(`downloadToTemp: timeout after ${DOWNLOAD_TIMEOUT_MS}ms for ${url}`)); });
    req.on("error", (e) => reject(new Error(`downloadToTemp: request error: ${e.message}`)));
  });
}

// ================================================================
// ffprobe verify
// ================================================================

interface ProbeResult {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  raw: any;
}

async function probeMedia(file: string): Promise<ProbeResult> {
  const { stdout } = await pExec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-show_entries", "stream=codec_type,codec_name,width,height,duration",
    "-of", "json",
    file,
  ], { maxBuffer: 4 * 1024 * 1024 });

  const parsed = JSON.parse(stdout);
  const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const duration = Number(parsed?.format?.duration ?? 0);
  return { duration: Number.isFinite(duration) ? duration : 0, hasVideo, hasAudio, raw: parsed };
}

// ================================================================
// Pipeline
// ================================================================

async function spawnFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    proc.on("error", (e) => reject(new Error(`ffmpeg spawn failed: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}. stderr tail: ${stderr.slice(-800)}`));
    });
  });
}

async function setJobStatus(
  jobId: string,
  status: RenderStatus,
  patch: Partial<Pick<RenderJobRow, "outputPath" | "outputUrl" | "duration" | "sizeBytes" | "probe" | "error" | "startedAt" | "finishedAt">> = {},
): Promise<void> {
  await db.update(renderJobsTable).set({ status, ...patch }).where(eq(renderJobsTable.id, jobId));
}

/**
 * Runs the full render pipeline for an existing job id. Idempotent.
 * Always updates the row to COMPLETED or FAILED — never leaves PROCESSING.
 */
export async function runRenderPipeline(jobId: string): Promise<void> {
  const rows = await db.select().from(renderJobsTable).where(eq(renderJobsTable.id, jobId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`runRenderPipeline: job ${jobId} not found`);
  if (row.status === "COMPLETED" || row.status === "PROCESSING") return;

  await setJobStatus(jobId, "PROCESSING", { startedAt: new Date(), error: null });

  const localOutputDir = RENDERS_DIR;
  fs.mkdirSync(localOutputDir, { recursive: true });
  const outputFileName = `render_${jobId}.mp4`;
  const outputPath = path.join(localOutputDir, outputFileName);
  const outputUrl = `/uploads/renders/${outputFileName}`;

  try {
    const input = (row.input as any) || {};
    const clips: RenderClipInput[] = Array.isArray(input.clips) ? input.clips : [];
    if (clips.length === 0) throw new Error("no clips to render");

    // 1. Resolve all clips to real local files
    const resolved: { file: string; duration: number }[] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const file = await resolveAssetToLocal(c.assetUrl);
      const probe = await probeMedia(file);
      if (!probe.hasVideo) {
        throw new Error(`clip #${i + 1} (${c.assetUrl}) has no video stream`);
      }
      if (!(probe.duration > 0)) {
        throw new Error(`clip #${i + 1} (${c.assetUrl}) has zero/unknown duration`);
      }
      resolved.push({ file, duration: probe.duration });
    }

    // 2. Build concat demuxer list (safe quoting)
    const listPath = path.join(TEMP_ASSETS_DIR, `concat_${jobId}.txt`);
    fs.mkdirSync(TEMP_ASSETS_DIR, { recursive: true });
    const lines = resolved.map((r) => {
      const escaped = r.file.replace(/'/g, "'\\''");
      return `file '${escaped}'`;
    });
    fs.writeFileSync(listPath, lines.join("\n") + "\n", "utf-8");

    // 3. Run ffmpeg — real files, real output (no pipe:0)
    //    Re-encode to guarantee a compatible single stream regardless of source codecs.
    const args: string[] = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-an", // clips are video-only by spec; audio wiring is a separate VOICE track concern
      "-movflags", "+faststart",
      outputPath,
    ];
    await spawnFfmpeg(args);

    // 3b. Mux the REAL audio track into the video (audioUrl is required — no silent fallback)
    const audioUrl: string = input.audioUrl.trim();
    const audioLocal = await resolveAssetToLocal(audioUrl);
    const audioProbe = await probeMedia(audioLocal);
    if (!audioProbe.hasAudio) {
      throw new Error(`Real audio asset missing: provided audioUrl has no audio stream: ${audioUrl}`);
    }
    if (!(audioProbe.duration > 0)) {
      throw new Error(`Real audio asset invalid: provided audioUrl has zero/unknown duration: ${audioUrl}`);
    }

    const mixedPath = outputPath + ".mixed.mp4";
    const mixArgs: string[] = [
      "-y",
      "-i", outputPath,
      "-i", audioLocal,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      "-movflags", "+faststart",
      mixedPath,
    ];
    await spawnFfmpeg(mixArgs);

    if (!fs.existsSync(mixedPath)) throw new Error("audio muxing failed: mixed file missing");
    const mst = fs.statSync(mixedPath);
    if (!mst.isFile() || mst.size === 0) throw new Error("audio muxing produced empty file");

    // atomic replace
    fs.renameSync(mixedPath, outputPath);

    // 4. Verify output
    if (!fs.existsSync(outputPath)) throw new Error("ffmpeg reported success but output file is missing");
    const st = fs.statSync(outputPath);
    if (!st.isFile() || st.size === 0) throw new Error(`output file is empty (size=${st.size})`);

    const outProbe = await probeMedia(outputPath);
    if (!outProbe.hasVideo) throw new Error("output has no video stream");
    if (!(outProbe.duration > 0)) throw new Error(`output duration is not > 0 (got ${outProbe.duration})`);
    if (!outProbe.hasAudio) throw new Error("final output missing audio stream — real audio was not muxed");

    // 5. Mark COMPLETED
    await setJobStatus(jobId, "COMPLETED", {
      outputPath,
      outputUrl,
      duration: outProbe.duration,
      sizeBytes: st.size,
      probe: outProbe.raw,
      finishedAt: new Date(),
      error: null,
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    // best-effort cleanup of partial output
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    await setJobStatus(jobId, "FAILED", {
      error: message.slice(0, 2000),
      finishedAt: new Date(),
    });
    // swallow — status is persisted
  }
}

/**
 * Legacy shim kept for the existing timeline/render routes:
 *   - creates the job (QUEUED)
 *   - kicks off runRenderPipeline() in the background
 *   - returns immediately with { jobId }
 */
export async function handleRenderPipeline(input: CreateRenderJobInput): Promise<{ jobId: string; videoPath?: string }> {
  const job = await createRenderJob(input);
  setImmediate(() => { void runRenderPipeline(job.id); });
  return { jobId: job.id };
}

// Re-export the row type for callers
export type { RenderJobRow };
