/**
 * KAYAN-TASK-32: deterministic job key builder for pipeline recovery.
 *
 * Format: FULL_PIPELINE:<runId>:<stage>:<shotId>
 *
 * - Same run + stage + shot → same key (deterministic).
 * - Different shot or stage → different key.
 * - Ensures UNIQUE partial index on production_pipeline.job_key prevents
 *   duplicate child jobs when a FULL_PIPELINE is retried or resumed.
 *
 * STAGE values are the leaf job types:
 *   VIDEO_GEN, VOICE_GEN, LIP_SYNC
 */

export type PipelineLeafStage = "VIDEO_GEN" | "VOICE_GEN" | "LIP_SYNC";

export function buildPipelineJobKey(
  runId: string,
  stage: PipelineLeafStage,
  shotId: number | string,
): string {
  if (!runId || typeof runId !== "string") {
    throw new Error("buildPipelineJobKey: runId is required");
  }
  if (!stage) {
    throw new Error("buildPipelineJobKey: stage is required");
  }
  if (shotId === null || shotId === undefined || String(shotId).length === 0) {
    throw new Error("buildPipelineJobKey: shotId is required");
  }
  return `FULL_PIPELINE:${runId}:${stage}:${shotId}`;
}
