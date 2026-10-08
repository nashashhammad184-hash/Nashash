/**
 * productionEngine — DB-backed production job executor.
 *
 * Task 61427 — UNIFY REAL PRODUCTION PIPELINE
 *
 * Design:
 *  - The ONLY production job store is PostgreSQL (production_pipeline table).
 *  - In-memory maps are NOT allowed (jobs must survive API restart).
 *  - GPU workloads (VIDEO_GEN, LIP_SYNC) are delegated to GpuQueueService → queue-worker.
 *  - VOICE_GEN uses Deepgram directly (real audio file on disk).
 *  - No Replicate, no dummy assets, no color video.
 *
 * Contracts (returned/consumed by callers):
 *   VIDEO_GEN     → { videoPath, videoUrl }
 *   VOICE_GEN     → { audioPath, audioUrl }
 *   LIP_SYNC      → { syncedVideoPath, syncedVideoUrl }
 *   MUSIC_SFX_GEN → OPEN_DEPENDENCY — throws explicitly with code="OPEN_DEPENDENCY"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { and, desc, eq, ne, inArray } from "drizzle-orm";
import { db, productionPipeline, productionTasksTable } from "@workspace/db";
import { generateVideoKayanGpu, generateLipSyncKayanGpu } from "./kayanGpuProvider";
import { logger } from "./logger";

export type ProductionJobType = "VIDEO_GEN" | "VOICE_GEN" | "LIP_SYNC" | "MUSIC_SFX_GEN";
export type ProductionJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ProductionJobPayload {
  projectId?: number;
  taskId?: number;
  prompt?: string;
  text?: string;
  videoUrl?: string;
  audioUrl?: string;
  voiceId?: string;
  model?: string;
  worldId?: string;
  [key: string]: unknown;
}

export interface ProductionJob {
  id: string;
  projectId?: number;
  type: ProductionJobType;
  status: ProductionJobStatus;
  progress: number;
  payload: ProductionJobPayload;
  providerJobId?: string | null;
  // KAYAN-TASK-32: pipeline recovery fields
  parentRunId?: string | null;
  jobKey?: string | null;
  output?: Record<string, unknown> | null;
  videoUrl?: string | null;
  error?: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

const DEEPGRAM_TTS_ENDPOINT = "https://api.deepgram.com/v1/speak";
const HTTP_TIMEOUT_MS = 25_000;

function getAudioDir(): string {
  const dir = path.resolve(process.cwd(), "uploads", "audio");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeJobId(): string {
  return `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function rowToJob(row: any): ProductionJob {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    type: row.type,
    status: row.status,
    progress: row.progress ?? 0,
    payload: (row.payload ?? {}) as ProductionJobPayload,
    providerJobId: row.providerJobId ?? null,
    parentRunId: row.parentRunId ?? null,
    jobKey: row.jobKey ?? null,
    output: (row.output ?? null) as Record<string, unknown> | null,
    videoUrl: row.videoUrl ?? null,
    error: row.errorMessage ?? null,
    retryCount: row.retryCount ?? 0,
    maxRetries: row.maxRetries ?? 3,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
    startedAt: row.startedAt ? (row.startedAt instanceof Date ? row.startedAt : new Date(row.startedAt)) : null,
    completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt : new Date(row.completedAt)) : null,
  };
}

// ================================================================
// Public API
// ================================================================

// KAYAN-TASK-16 — Retry classification.
//
// Policy (DB is source of truth; provider idempotency matters):
//   - NO_RETRY       → validation / config / input errors; retrying won't help.
//   - NO_RETRY_ACCEPTED → provider already accepted a job (providerJobId set)
//                         before the failure; NEVER blindly re-submit.
//   - RETRY_LIMITED  → transient error BEFORE provider acceptance.
export type RetryDecision = 'NO_RETRY' | 'NO_RETRY_ACCEPTED' | 'RETRY_LIMITED';

export function classifyRetry(
  errMsg: string,
  ctx: { providerJobId?: string | null; type: string },
): RetryDecision {
  const m = (errMsg || '').toLowerCase();
  if (ctx.providerJobId && ctx.providerJobId.trim().length > 0) {
    return 'NO_RETRY_ACCEPTED';
  }
  const noRetryPatterns = [
    'requires ', 'not configured', 'not implemented', 'is not implemented',
    'open_dependency', 'invalid', 'validation', 'schema', 'unsupported',
    'not found', 'missing', 'empty', 'out of range', 'exceeds', 'violates',
    'no real audio', 'silent', 'forbidden',
  ];
  for (const pat of noRetryPatterns) {
    if (m.includes(pat)) return 'NO_RETRY';
  }
  return 'RETRY_LIMITED';
}

export interface CreateProductionJobOptions {
  /** KAYAN-TASK-32: id of the parent FULL_PIPELINE run (if any). */
  parentRunId?: string;
  /** KAYAN-TASK-32: deterministic idempotency key. */
  jobKey?: string;
}

export async function createProductionJob(
  type: ProductionJobType,
  payload: ProductionJobPayload,
  maxRetries = 3,
  options: CreateProductionJobOptions = {},
): Promise<ProductionJob> {
  if (type === "MUSIC_SFX_GEN") {
    // KAYAN-TASK-13 — Explicit OPEN_DEPENDENCY. No real music/SFX provider is
    // configured. We refuse to fabricate audio (no sine/silence/placeholder).
    // Callers can detect this via error.code === "OPEN_DEPENDENCY".
    const err: any = new Error(
      "MUSIC_SFX_GEN is OPEN_DEPENDENCY: no real music/SFX provider is configured. " +
      "Refusing to fabricate audio. Integrate a real provider before enabling this feature.",
    );
    err.code = "OPEN_DEPENDENCY";
    err.feature = "MUSIC_SFX_GEN";
    throw err;
  }

  const id = makeJobId();
  const now = new Date();

  const [row] = await db
    .insert(productionPipeline)
    .values({
      id,
      projectId: payload.projectId ?? null,
      jobId: id,
      type,
      status: "pending",
      progress: 0,
      payload: payload as any,
      retryCount: 0,
      maxRetries,
      // KAYAN-TASK-32: only set when explicitly provided (legacy callers unaffected)
      parentRunId: options.parentRunId ?? null,
      jobKey: options.jobKey ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) throw new Error("failed to persist production job");

  logger.info({ jobId: id, type }, "Production job created and queued (DB-backed)");

  // Fire-and-forget — the actual transition + retries are persisted row by row
  // KAYAN-TASK-36: tests set NASHASH_DISABLE_AUTO_WORKER=1 to isolate DB
  // state from the in-process worker and avoid races on job status.
  if (process.env.NASHASH_DISABLE_AUTO_WORKER !== "1") {
    setImmediate(() => {
      void processNextQueuedJob();
    });
  }

  return rowToJob(row);
}

/**
 * KAYAN-TASK-33: find a production job by deterministic job_key.
 * Returns undefined if not found. Used by pipeline resume to reuse
 * completed/in-flight child jobs instead of creating duplicates.
 */
export async function findProductionJobByJobKey(jobKey: string): Promise<ProductionJob | undefined> {
  if (!jobKey || typeof jobKey !== "string") return undefined;
  const rows = await db
    .select()
    .from(productionPipeline)
    .where(eq(productionPipeline.jobKey, jobKey))
    .limit(1);
  return rows[0] ? rowToJob(rows[0]) : undefined;
}

export async function getProductionJob(jobId: string): Promise<ProductionJob | undefined> {
  const rows = await db
    .select()
    .from(productionPipeline)
    .where(eq(productionPipeline.id, jobId))
    .limit(1);
  return rows[0] ? rowToJob(rows[0]) : undefined;
}

export async function listProductionJobs(projectId?: number): Promise<ProductionJob[]> {
  const q = db.select().from(productionPipeline).orderBy(desc(productionPipeline.createdAt)).limit(100);
  const rows = projectId !== undefined
    ? await db.select().from(productionPipeline)
        .where(eq(productionPipeline.projectId, projectId))
        .orderBy(desc(productionPipeline.createdAt))
    : await q;
  return rows.map(rowToJob);
}

// ================================================================
// Queue processing (single-flight within this process)
// ================================================================

let isProcessing = false;

async function setStatus(
  jobId: string,
  status: ProductionJobStatus,
  patch: Partial<{ progress: number; startedAt: Date | null; completedAt: Date | null; errorMessage: string | null; output: any; videoUrl: string | null; providerJobId: string | null; retryCount: number }> = {},
): Promise<void> {
  await db
    .update(productionPipeline)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(eq(productionPipeline.id, jobId));
}

export async function processNextQueuedJob(): Promise<ProductionJob | null> {
  if (isProcessing) return null;

  const queued = await db
    .select()
    .from(productionPipeline)
    .where(and(
      eq(productionPipeline.status, "pending"),
      ne(productionPipeline.type, "FULL_PIPELINE"),
    ))
    .orderBy(productionPipeline.createdAt)
    .limit(1);

  const row = queued[0];
  if (!row) return null;

  isProcessing = true;
  const jobId = row.id;
  const job = rowToJob(row);

  await setStatus(jobId, "processing", { progress: 15, startedAt: new Date(), errorMessage: null });

  logger.info({ jobId, type: job.type, retryCount: job.retryCount }, "Processing production job");

  try {
    if (job.payload.taskId && typeof job.payload.taskId === "number") {
      try {
        await db.update(productionTasksTable).set({ status: "processing" }).where(eq(productionTasksTable.id, job.payload.taskId));
      } catch (e) {
        logger.warn({ err: e }, "could not mark production task processing");
      }
    }

    await setStatus(jobId, "processing", { progress: 35 });

    let output: Record<string, unknown> = {};
    let videoUrl: string | null = null;
    let providerJobId: string | null = null;

    switch (job.type) {
      case "VIDEO_GEN": {
        const prompt = (job.payload.prompt || "").toString().trim();
        if (!prompt) throw new Error("VIDEO_GEN requires prompt");
        const task = (job.payload as any).task === "i2v" ? "i2v" : "t2v";
        const refB64 = (job.payload as any).referenceImageBase64;
        if (task === "i2v" && (!refB64 || typeof refB64 !== "string" || refB64.length < 64)) {
          throw new Error("VIDEO_GEN task=i2v requires referenceImageBase64");
        }
        const result = await generateVideoKayanGpu({
          prompt,
          task,
          onEnqueued: async (qid: string) => {
            try { await setStatus(jobId, "processing", { providerJobId: qid }); } catch {}
          },
          referenceImageBase64: refB64 ?? null,
          negativePrompt: (job.payload as any).negativePrompt,
          fps: (job.payload as any).fps,
          durationSeconds: (job.payload as any).durationSeconds ?? 5,
          numFrames: (job.payload as any).numFrames,
          aspectRatio: (job.payload as any).aspectRatio,
          seed: (job.payload as any).seed,
          resolution: (job.payload as any).resolution,
          steps: (job.payload as any).steps,
        });
        if (!result.videoPath || !fs.existsSync(result.videoPath)) {
          throw new Error(`VIDEO_GEN produced no real video file on disk: ${result.videoPath}`);
        }
        const st = fs.statSync(result.videoPath);
        if (!st.isFile() || st.size === 0) throw new Error(`VIDEO_GEN output is empty: ${result.videoPath}`);
        output = { videoPath: result.videoPath, videoUrl: result.videoUrl };
        videoUrl = result.videoUrl;
        providerJobId = result.jobId;
        break;
      }
      case "VOICE_GEN": {
        const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
        if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured");
        const text = (job.payload.text || job.payload.prompt)?.toString().trim();
        if (!text) throw new Error("VOICE_GEN requires text");
        const model = job.payload.model?.trim() || process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-asteria-en";
        const res = await fetch(`${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(model)}`, {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Deepgram TTS failed (${res.status}): ${await res.text().catch(() => "")}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) throw new Error("Deepgram TTS returned 0 bytes");
        const filename = `job_voice_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp3`;
        const filePath = path.join(getAudioDir(), filename);
        fs.writeFileSync(filePath, buf);
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size === 0) throw new Error("VOICE_GEN failed to write audio file");
        output = { audioPath: filePath, audioUrl: `/uploads/audio/${filename}`, fileSize: st.size };
        break;
      }
      case "LIP_SYNC": {
        const videoPath = job.payload.videoUrl?.toString().trim();
        const audioPath = job.payload.audioUrl?.toString().trim();
        if (!videoPath || !audioPath) throw new Error("LIP_SYNC requires videoUrl and audioUrl");
        const result: any = await generateLipSyncKayanGpu({
          videoPath, audioPath,
          onEnqueued: async (qid: string) => {
            try { await setStatus(jobId, "processing", { providerJobId: qid }); } catch {}
          },
        });
        // KAYAN-TASK-07 — only a real synced asset counts as success.
        // no_face_in_video is raised as a failure by the provider; any legacy
        // skip flag reaching here is also treated as failure (defense in depth).
        if (result?.skipped) {
          const err: any = new Error(
            `LIP_SYNC skipped (${result.reason || 'unknown'}) — production Lip Sync did not run`,
          );
          err.code = 'LIPSYNC_NO_FACE';
          err.diagnostic = result;
          throw err;
        }
        if (!result.videoPath || !fs.existsSync(result.videoPath)) {
          throw new Error(`LIP_SYNC produced no real video file: ${result.videoPath}`);
        }
        const st = fs.statSync(result.videoPath);
        if (!st.isFile() || st.size === 0) throw new Error("LIP_SYNC output is empty");
        // KAYAN-TASK-07 — output must differ from input (real transformation).
        const inAbs = path.resolve(videoPath);
        const outAbs = path.resolve(result.videoPath);
        if (inAbs === outAbs) {
          throw new Error(`LIP_SYNC output equals input video — no actual sync performed (${outAbs})`);
        }
        output = { syncedVideoPath: result.videoPath, syncedVideoUrl: result.videoUrl };
        videoUrl = result.videoUrl;
        providerJobId = result.jobId;
        break;
      }
      default:
        throw new Error(`Unsupported production job type: ${job.type}`);
    }

    await setStatus(jobId, "completed", {
      progress: 100,
      completedAt: new Date(),
      errorMessage: null,
      output,
      videoUrl,
      providerJobId,
    });

    if (job.payload.taskId && typeof job.payload.taskId === "number") {
      try {
        await db.update(productionTasksTable).set({ status: "completed" }).where(eq(productionTasksTable.id, job.payload.taskId));
      } catch {}
    }

    logger.info({ jobId, type: job.type }, "Production job completed");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown execution error";
    const current = await getProductionJob(jobId);
    const retries = (current?.retryCount ?? 0) + 1;
    const maxRetries = current?.maxRetries ?? 3;
    // KAYAN-TASK-16 — classify before retrying. Never duplicate GPU work.
    const priorProviderJobId = current?.providerJobId ?? null;
    const decision = classifyRetry(msg, { providerJobId: priorProviderJobId, type: job.type });
    const shouldRetry = decision === "RETRY_LIMITED" && retries <= maxRetries;

    if (shouldRetry) {
      await setStatus(jobId, "pending", {
        progress: 0,
        retryCount: retries,
        errorMessage: msg,
      });
      logger.warn(
        { jobId, retryCount: retries, maxRetries, decision, err: msg },
        "Production job re-queued (transient)",
      );
    } else {
      const finalError =
        decision === "NO_RETRY_ACCEPTED"
          ? `NO_RETRY_ACCEPTED: provider already accepted job ${priorProviderJobId}; refusing duplicate submission. Original error: ${msg}`
          : decision === "NO_RETRY"
            ? `NO_RETRY (non-transient): ${msg}`
            : msg;
      await setStatus(jobId, "failed", {
        progress: 0,
        completedAt: new Date(),
        errorMessage: finalError,
      });
      if (job.payload.taskId && typeof job.payload.taskId === "number") {
        try {
          await db.update(productionTasksTable).set({ status: "failed" }).where(eq(productionTasksTable.id, job.payload.taskId));
        } catch {}
      }
      logger.error(
        { jobId, decision, priorProviderJobId, err: msg },
        "Production job permanently failed",
      );
    }
  } finally {
    isProcessing = false;
    setImmediate(() => { void processNextQueuedJob(); });
  }

  return job;
}

// ================================================================
// KAYAN-TASK-36: Worker-failure recovery helpers
// ================================================================
/**
 * Mark a single child job as failed with WORKER_TIMEOUT.
 * Called when the pipeline has been waiting on a processing job whose
 * `updatedAt` has not moved for longer than the stale threshold.
 * Preserves providerJobId (TASK-31) so a rebuild will not blindly re-submit
 * before the previous provider request is considered.
 */
export async function markJobWorkerTimeout(jobId: string, reason: string): Promise<void> {
  await db
    .update(productionPipeline)
    .set({
      status: "failed",
      errorMessage: `WORKER_TIMEOUT: ${reason}`,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(productionPipeline.id, jobId),
      eq(productionPipeline.status, "processing"),
    ));
}

/**
 * Sweep all child jobs (non FULL_PIPELINE) that are stuck in 'processing'
 * with no updatedAt change for > maxAgeMs. Converts them to 'failed'
 * with WORKER_TIMEOUT. Idempotent — safe to run repeatedly.
 */
export async function sweepStaleChildJobs(maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .select()
    .from(productionPipeline)
    .where(and(
      eq(productionPipeline.status, "processing"),
      ne(productionPipeline.type, "FULL_PIPELINE"),
    ));
  let n = 0;
  for (const r of rows) {
    const lastTouch = (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt ?? 0)).getTime();
    if (lastTouch < cutoff.getTime()) {
      await markJobWorkerTimeout(r.id, `no progress for ${Math.round((Date.now() - lastTouch) / 1000)}s`);
      n++;
    }
  }
  return n;
}

// ================================================================
// Background worker + boot recovery
// ================================================================

let workerInterval: NodeJS.Timeout | null = null;
let sweepInterval: NodeJS.Timeout | null = null;

export function startProductionWorker(pollIntervalMs = 5000): void {
  if (workerInterval) return;

  // Boot recovery: any PROCESSING row without a live executor → back to pending (retry) or failed.
  void (async () => {
    try {
      const stuck = await db
        .select()
        .from(productionPipeline)
        .where(and(
          eq(productionPipeline.status, "processing"),
          ne(productionPipeline.type, "FULL_PIPELINE"),
        ));
      for (const r of stuck) {
        const retries = (r.retryCount ?? 0) + 1;
        const maxRetries = r.maxRetries ?? 3;
        if (retries <= maxRetries) {
          await db.update(productionPipeline)
            .set({ status: "pending", progress: 0, retryCount: retries, updatedAt: new Date(), errorMessage: "recovered: worker restart" })
            .where(eq(productionPipeline.id, r.id));
        } else {
          await db.update(productionPipeline)
            .set({ status: "failed", errorMessage: "recovered: worker restart, retries exhausted", completedAt: new Date(), updatedAt: new Date() })
            .where(eq(productionPipeline.id, r.id));
        }
      }
      if (stuck.length > 0) logger.info({ recovered: stuck.length }, "production engine boot recovery");
    } catch (e) {
      logger.warn({ err: e }, "production engine boot recovery failed");
    }
  })();

  workerInterval = setInterval(() => { void processNextQueuedJob(); }, pollIntervalMs);

  const sweepMs = Number(process.env.SWEEP_INTERVAL_MS || "60000");
  const disableAuto = process.env.NASHASH_DISABLE_AUTO_WORKER === "1";
  if (!disableAuto && Number.isFinite(sweepMs) && sweepMs > 0) {
    const staleMs = Number(process.env.WORKER_STALE_MS || "600000");
    sweepInterval = setInterval(() => {
      void (async () => {
        try {
          const n = await sweepStaleChildJobs(staleMs);
          if (n > 0) logger.warn({ swept: n }, "TASK-37: periodic stale-child sweep");
        } catch (e) {
          logger.warn({ err: e }, "TASK-37: periodic sweep failed");
        }
      })();
    }, sweepMs);
    logger.info({ sweepMs, staleMs }, "Starting periodic stale-child sweep");
  }
  logger.info("Starting background production worker (DB-backed)...");
}

export function stopProductionWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

// Backwards-compat: unused symbols referenced elsewhere
export { productionPipeline };

// Suppress unused-import lint when inArray not needed
void inArray;
void and;
