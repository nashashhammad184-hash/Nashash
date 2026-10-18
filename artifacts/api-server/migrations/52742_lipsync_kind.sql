BEGIN;
ALTER TABLE gpu_jobs DROP CONSTRAINT IF EXISTS gpu_jobs_kind_check;
ALTER TABLE gpu_jobs ADD CONSTRAINT gpu_jobs_kind_check
  CHECK (kind IN ('VIDEO_JOB','LLM_JOB','LIP_SYNC_JOB'));
ALTER TABLE gpu_lock DROP CONSTRAINT IF EXISTS gpu_lock_holder_kind_check;
ALTER TABLE gpu_lock ADD CONSTRAINT gpu_lock_holder_kind_check
  CHECK (holder_kind IN ('VIDEO_JOB','LLM_JOB','LIP_SYNC_JOB'));
COMMIT;
