BEGIN;

CREATE TABLE IF NOT EXISTS gpu_lock (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  holder_job_id UUID,
  holder_kind   TEXT CHECK (holder_kind IN ('VIDEO_JOB','LLM_JOB')),
  acquired_at   TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ
);

INSERT INTO gpu_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gpu_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('VIDEO_JOB','LLM_JOB')),
  status        TEXT NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS gpu_jobs_queue_idx
  ON gpu_jobs (created_at ASC) WHERE status = 'QUEUED';

CREATE INDEX IF NOT EXISTS gpu_jobs_running_idx
  ON gpu_jobs (id) WHERE status = 'RUNNING';

COMMIT;
