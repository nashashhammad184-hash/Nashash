/**
 * KAYAN-TASK-35: stage-level idempotent reuse for FULL_PIPELINE resume.
 *
 * Given (runId, stage, shotId) this module inspects the existing child job
 * (identified by deterministic jobKey) and decides whether the pipeline
 * should reuse its result, wait on it, or rebuild it.
 *
 * Rules:
 *   completed + valid artifact on disk        → SKIPPED_EXISTING_RESULT
 *   completed + missing / zero-byte artifact  → REBUILD_REQUIRED
 *   processing                                → REUSE_PROCESSING_JOB
 *   pending/queued                            → REUSE_QUEUED_JOB
 *   failed                                    → REBUILD_REQUIRED
 *   no job                                    → MISSING
 *
 * "Valid" means: the artifact path recorded in `output` exists on disk,
 * is a regular file, and has size > 0. A completed status alone is NOT
 * sufficient (TASK-35 PHASE 4).
 */
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, productionPipeline } from "@workspace/db";
import {
  findProductionJobByJobKey,
  type ProductionJob,
} from "../productionEngine";
import { buildPipelineJobKey, type PipelineLeafStage } from "./jobKeys";

export type StageReuseDecision =
  | "SKIPPED_EXISTING_RESULT"
  | "REBUILD_REQUIRED"
  | "REUSE_PROCESSING_JOB"
  | "REUSE_QUEUED_JOB"
  | "MISSING";

export interface StageReuseResult {
  decision: StageReuseDecision;
  job?: ProductionJob;
  reason?: string;
}

export function fileOnDiskValid(p: unknown): boolean {
  if (typeof p !== "string" || p.trim().length === 0) return false;
  try {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export function validateVideoOutputOnDisk(out: unknown): boolean {
  if (!out || typeof out !== "object") return false;
  const o = out as any;
  return (
    fileOnDiskValid(o.videoPath) &&
    typeof o.videoUrl === "string" &&
    o.videoUrl.trim().length > 0
  );
}

export function validateVoiceOutputOnDisk(out: unknown): boolean {
  if (!out || typeof out !== "object") return false;
  const o = out as any;
  return (
    fileOnDiskValid(o.audioPath) &&
    typeof o.audioUrl === "string" &&
    o.audioUrl.trim().length > 0
  );
}

export function validateLipsyncOutputOnDisk(out: unknown): boolean {
  if (!out || typeof out !== "object") return false;
  const o = out as any;
  return (
    fileOnDiskValid(o.syncedVideoPath) &&
    typeof o.syncedVideoUrl === "string" &&
    o.syncedVideoUrl.trim().length > 0
  );
}

export async function decideStageReuse(opts: {
  runId: string;
  stage: PipelineLeafStage;
  shotId: number | string;
  validateOutput: (out: unknown) => boolean;
}): Promise<StageReuseResult> {
  const jobKey = buildPipelineJobKey(opts.runId, opts.stage, opts.shotId);
  const existing = await findProductionJobByJobKey(jobKey);
  if (!existing) return { decision: "MISSING" };

  if (existing.status === "completed") {
    if (opts.validateOutput(existing.output || {})) {
      return { decision: "SKIPPED_EXISTING_RESULT", job: existing };
    }
    return {
      decision: "REBUILD_REQUIRED",
      job: existing,
      reason: "completed but output invalid/missing on disk",
    };
  }
  if (existing.status === "processing") {
    return { decision: "REUSE_PROCESSING_JOB", job: existing };
  }
  if (existing.status === "pending") {
    return { decision: "REUSE_QUEUED_JOB", job: existing };
  }
  // failed
  return {
    decision: "REBUILD_REQUIRED",
    job: existing,
    reason: "previous job failed",
  };
}

/**
 * Reset an existing child job so the worker re-runs it with the SAME jobKey.
 * Clears output/videoUrl/providerJobId so the rebuild is a deliberate fresh
 * execution (not a retry of the old provider request).
 */
export async function resetJobForRebuild(jobId: string): Promise<void> {
  await db
    .update(productionPipeline)
    .set({
      status: "pending",
      progress: 0,
      output: null as any,
      videoUrl: null,
      providerJobId: null,
      errorMessage: null,
      retryCount: 0,
      completedAt: null,
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(productionPipeline.id, jobId));
}

export async function countChildJobsForRun(runId: string): Promise<number> {
  const rows = await db
    .select({ id: productionPipeline.id })
    .from(productionPipeline)
    .where(eq(productionPipeline.parentRunId, runId));
  return rows.length;
}
