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
import { eq, desc, sql } from "drizzle-orm";
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
  /** Optional absolute timeline position. If present, clips must be contiguous
   *  (gap fill via color background is forbidden by policy). */
  startTime?: number;
}

export interface CreateRenderJobInput {
  projectId: number;
  clips: RenderClipInput[];
  /** OPTIONAL real audio asset (VOICE track). Local /uploads/... path or http(s) URL.
   *  If absent or empty → video-only MP4 (dialogue-free projects).
   *  Silent fallback (anullsrc / silent.mp3) is still FORBIDDEN. */
  audioUrl?: string;
  watermarkText?: string;
  subtitlesText?: string;
  /** TASK-34: link this render job to a pipeline run for reuse on resume. */
  pipelineRunId?: string;
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
  // KAYAN-TASK-28: audioUrl is OPTIONAL. If absent → video-only mode.
  // Still refuse silent fallback assets: if audioUrl is provided it must be
  // a non-empty string; the actual "real asset" validation happens at run time.
  const audioProvided =
    typeof input.audioUrl === "string" && input.audioUrl.trim().length > 0;
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
        audioUrl: audioProvided ? input.audioUrl!.trim() : null,
        watermarkText: input.watermarkText ?? null,
        subtitlesText: input.subtitlesText ?? null,
        pipelineRunId: input.pipelineRunId ?? null,
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
function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

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
    const clipsRaw: RenderClipInput[] = Array.isArray(input.clips) ? input.clips : [];
    if (clipsRaw.length === 0) throw new Error("no clips to render");
    const clips = [...clipsRaw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    fs.mkdirSync(TEMP_ASSETS_DIR, { recursive: true });

    // ─── Validate timeline policy: if any clip has startTime, all must, and
    // they must be contiguous (no gap fill allowed by policy). ───
    const anyStart = clips.some((c) => typeof c.startTime === "number");
    const allStart = clips.every((c) => typeof c.startTime === "number");
    if (anyStart && !allStart) {
      throw new Error("timeline policy: either all clips have startTime or none do");
    }

    // ─── Resolve + trim each clip ───
    const trimmed: { file: string; duration: number; timelineStart: number }[] = [];
    let timelineCursor = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const file = await resolveAssetToLocal(c.assetUrl);
      const probe = await probeMedia(file);
      if (!probe.hasVideo) throw new Error(`clip #${i + 1} (${c.assetUrl}) has no video stream`);
      if (!(probe.duration > 0)) throw new Error(`clip #${i + 1} (${c.assetUrl}) has zero/unknown duration`);

      const srcStart = Math.max(0, Number(c.sourceStart ?? 0));
      const srcEnd = c.sourceEnd != null ? Number(c.sourceEnd) : probe.duration;
      if (!(srcEnd > srcStart)) {
        throw new Error(`clip #${i + 1}: sourceEnd (${srcEnd}) must be > sourceStart (${srcStart})`);
      }
      if (srcEnd > probe.duration + 0.05) {
        throw new Error(`clip #${i + 1}: sourceEnd ${srcEnd}s exceeds source duration ${probe.duration}s`);
      }
      const trimDur = srcEnd - srcStart;

      // Re-encode the trimmed segment to a uniform format (H.264 yuv420p).
      const trimmedPath = path.join(TEMP_ASSETS_DIR, `trim_${jobId}_${i}.mp4`);
      const trimArgs = [
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", String(srcStart),
        "-to", String(srcEnd),
        "-i", file,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        trimmedPath,
      ];
      await spawnFfmpeg(trimArgs);
      if (!fs.existsSync(trimmedPath)) throw new Error(`clip #${i + 1}: trim produced no file`);
      const tst = fs.statSync(trimmedPath);
      if (!tst.isFile() || tst.size === 0) throw new Error(`clip #${i + 1}: trim produced empty file`);
      const tprobe = await probeMedia(trimmedPath);
      if (!(tprobe.duration > 0)) throw new Error(`clip #${i + 1}: trimmed duration is not > 0`);

      const tStart = allStart ? Number(c.startTime) : timelineCursor;
      if (allStart) {
        if (Math.abs(tStart - timelineCursor) > 0.01) {
          throw new Error(
            `timeline policy: clip #${i + 1} startTime=${tStart} does not match expected contiguous cursor ${timelineCursor}. Gaps are not allowed (no color fill).`
          );
        }
      }
      trimmed.push({ file: trimmedPath, duration: tprobe.duration, timelineStart: tStart });
      timelineCursor = tStart + tprobe.duration;
    }
    const videoDuration = timelineCursor;

    // ─── Concat trimmed clips ───
    const listPath = path.join(TEMP_ASSETS_DIR, `concat_${jobId}.txt`);
    const lines = trimmed.map((r) => `file '${r.file.replace(/'/g, "'\\''")}'`);
    fs.writeFileSync(listPath, lines.join("\n") + "\n", "utf-8");

    const concatPath = path.join(TEMP_ASSETS_DIR, `concat_${jobId}.mp4`);
    await spawnFfmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-an",
      "-movflags", "+faststart",
      concatPath,
    ]);
    if (!fs.existsSync(concatPath)) throw new Error("concat produced no file");
    const cst = fs.statSync(concatPath);
    if (!cst.isFile() || cst.size === 0) throw new Error("concat produced empty file");
    const cprobe = await probeMedia(concatPath);
    if (!(cprobe.duration > 0)) throw new Error("concat duration is not > 0");
    if (Math.abs(cprobe.duration - videoDuration) > 1.0) {
      throw new Error(`concat duration ${cprobe.duration}s mismatch expected ${videoDuration}s`);
    }

    // ─── Audio track ───
    const audioUrl: string = String(input.audioUrl || "").trim();
    // KAYAN-TASK-28: audio is OPTIONAL. If empty → VIDEO_ONLY mode.
    const audioMode: "AUDIO" | "VIDEO_ONLY" = audioUrl ? "AUDIO" : "VIDEO_ONLY";
    let audioLocal: string | null = null;
    if (audioMode === "AUDIO") {
      audioLocal = await resolveAssetToLocal(audioUrl);
      const audioProbe = await probeMedia(audioLocal);
      if (!audioProbe.hasAudio) throw new Error(`audioUrl has no audio stream: ${audioUrl}`);
      if (!(audioProbe.duration > 0)) throw new Error(`audioUrl has zero duration: ${audioUrl}`);

    // Policy: audio is trimmed to videoDuration. If audio is >1.5x video or
    // shorter than 95% of the video, that is a mismatch → fail loudly.
    if (audioProbe.duration < videoDuration * 0.95) {
      throw new Error(
        `audio policy: audio duration ${audioProbe.duration}s is shorter than video ${videoDuration}s by more than 5%`
      );
    }
    if (audioProbe.duration > videoDuration * 1.5 + 1.0) {
      throw new Error(
        `audio policy: audio duration ${audioProbe.duration}s exceeds video ${videoDuration}s by more than 50%`
      );
    }
    }

    // ─── Build final filter chain: watermark + subtitles burn-in ───
    const vfParts: string[] = [];
    const wmText = typeof input.watermarkText === "string" ? input.watermarkText.trim() : "";
    if (wmText) {
      const safe = escapeDrawtext(wmText);
      vfParts.push(
        `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${safe}':fontcolor=white@0.85:fontsize=h/20:box=1:boxcolor=black@0.45:boxborderw=10:x=(w-text_w)/2:y=h-th-30`
      );
    }

    let srtPath: string | null = null;
    const subsText = typeof input.subtitlesText === "string" ? input.subtitlesText.trim() : "";
    if (subsText) {
      srtPath = path.join(TEMP_ASSETS_DIR, `subs_${jobId}.srt`);
      fs.writeFileSync(srtPath, subsText, "utf-8");
      vfParts.push(`subtitles='${escapeFilterPath(srtPath)}'`);
    }

    const finalVf = vfParts.length > 0 ? vfParts.join(",") : "null";

    const finalArgs: string[] = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", concatPath,
    ];
    if (audioMode === "AUDIO" && audioLocal) {
      finalArgs.push("-i", audioLocal);
    }
    if (finalVf !== "null") {
      finalArgs.push("-vf", finalVf);
    }
    finalArgs.push("-map", "0:v:0");
    if (audioMode === "AUDIO") {
      finalArgs.push("-map", "1:a:0");
    }
    finalArgs.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    );
    if (audioMode === "AUDIO") {
      finalArgs.push("-c:a", "aac", "-b:a", "192k");
    }
    finalArgs.push(
      "-t", String(videoDuration),
      "-movflags", "+faststart",
      outputPath,
    );
    await spawnFfmpeg(finalArgs);

    // ─── Verify final output ───
    if (!fs.existsSync(outputPath)) throw new Error("ffmpeg reported success but output file is missing");
    const st = fs.statSync(outputPath);
    if (!st.isFile() || st.size === 0) throw new Error(`output file is empty (size=${st.size})`);
    const outProbe = await probeMedia(outputPath);
    if (!outProbe.hasVideo) throw new Error("output has no video stream");
    if (!(outProbe.duration > 0)) throw new Error(`output duration is not > 0 (got ${outProbe.duration})`);
    if (Math.abs(outProbe.duration - videoDuration) > 1.5) {
      throw new Error(`output duration ${outProbe.duration}s deviates from expected ${videoDuration}s`);
    }

    // KAYAN-TASK-28: audio presence validated per mode.
    if (audioMode === "AUDIO" && !outProbe.hasAudio) {
      throw new Error("output has no audio stream — real audio was not muxed");
    }
    if (audioMode === "VIDEO_ONLY" && outProbe.hasAudio) {
      throw new Error("output unexpectedly has audio in VIDEO_ONLY mode");
    }
    try { fs.unlinkSync(listPath); } catch {}
    try { fs.unlinkSync(concatPath); } catch {}
    for (const t of trimmed) { try { fs.unlinkSync(t.file); } catch {} }
    if (srtPath) { try { fs.unlinkSync(srtPath); } catch {} }

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

// ================================================================
// TASK-34: Render reuse helpers
// ================================================================
export async function findRenderJobByPipelineRun(
  pipelineRunId: string,
): Promise<RenderJobStatus | null> {
  if (!pipelineRunId || !pipelineRunId.trim()) return null;
  const rows = await db
    .select()
    .from(renderJobsTable)
    .where(sql`${renderJobsTable.input}->>'pipelineRunId' = ${pipelineRunId}`)
    .orderBy(desc(renderJobsTable.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toStatus(row) : null;
}

export function isRenderOutputValid(job: RenderJobStatus | null): boolean {
  if (!job || job.status !== "COMPLETED") return false;
  if (!job.outputPath) return false;
  try {
    if (!fs.existsSync(job.outputPath)) return false;
    const st = fs.statSync(job.outputPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

// Re-export the row type for callers
export type { RenderJobRow };
