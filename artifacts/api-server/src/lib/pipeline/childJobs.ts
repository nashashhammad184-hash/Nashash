/**
 * KAYAN-TASK-33: idempotent child job creation for FULL_PIPELINE recovery.
 *
 * For every (runId, stage, shotId) pair, this returns the existing
 * production_pipeline child job if one already exists with that job_key.
 * Otherwise it creates a new one with the deterministic key.
 *
 * This is the ONLY path FULL_PIPELINE should use to create child jobs.
 * Direct createProductionJob() calls from executePipeline bypass the
 * job_key uniqueness guarantee.
 */
import {
  createProductionJob,
  findProductionJobByJobKey,
  type ProductionJob,
  type ProductionJobPayload,
  type ProductionJobType,
} from "../productionEngine";
import { buildPipelineJobKey, type PipelineLeafStage } from "./jobKeys";
import { logger } from "../logger";

export async function getOrCreateChildJob(
  type: ProductionJobType,
  runId: string,
  stage: PipelineLeafStage,
  shotId: number | string,
  payload: ProductionJobPayload,
  maxRetries = 3,
): Promise<ProductionJob> {
  const jobKey = buildPipelineJobKey(runId, stage, shotId);

  const existing = await findProductionJobByJobKey(jobKey);
  if (existing) {
    logger.info(
      { jobId: existing.id, jobKey, status: existing.status },
      "pipeline: reusing existing child job",
    );
    return existing;
  }

  logger.info({ jobKey, type, shotId }, "pipeline: creating new child job");
  return await createProductionJob(type, payload, maxRetries, {
    parentRunId: runId,
    jobKey,
  });
}
