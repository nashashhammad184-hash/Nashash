-- KAYAN-TASK-32: Pipeline recovery foundation
-- Adds parent_run_id and job_key columns to production_pipeline.
-- Both are NULL-able; existing rows keep NULL. No historical data change.
--
-- parent_run_id: links child jobs (VIDEO_GEN, VOICE_GEN, LIP_SYNC) back to
--                their FULL_PIPELINE parent run.
-- job_key:       deterministic idempotency key:
--                FULL_PIPELINE:<runId>:<stage>:<shotId>.
--                UNIQUE only when NOT NULL (partial index) so legacy rows
--                with job_key=NULL do not conflict.

BEGIN;

ALTER TABLE production_pipeline
  ADD COLUMN IF NOT EXISTS parent_run_id TEXT NULL;

ALTER TABLE production_pipeline
  ADD COLUMN IF NOT EXISTS job_key TEXT NULL;

-- Unique partial index on job_key (ignore NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS production_pipeline_job_key_uniq
  ON production_pipeline (job_key)
  WHERE job_key IS NOT NULL;

-- Index for "find all child jobs of a pipeline run"
CREATE INDEX IF NOT EXISTS production_pipeline_parent_run_id_idx
  ON production_pipeline (parent_run_id);

-- Index for "find child jobs of a run by stage type"
CREATE INDEX IF NOT EXISTS production_pipeline_parent_run_id_type_idx
  ON production_pipeline (parent_run_id, type);

-- Extend status with 'interrupted' if there is a CHECK constraint
-- (Currently status is plain TEXT with no CHECK; add a comment for clarity.)
COMMENT ON COLUMN production_pipeline.status IS
  'Valid values: pending, processing, completed, failed, interrupted (KAYAN-TASK-32)';

COMMIT;
