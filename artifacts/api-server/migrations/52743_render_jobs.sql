BEGIN;

CREATE TABLE IF NOT EXISTS render_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'QUEUED'
               CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  input        JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_path  TEXT,
  output_url   TEXT,
  duration     DOUBLE PRECISION,
  size_bytes   BIGINT,
  probe        JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS render_jobs_project_idx
  ON render_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS render_jobs_status_idx
  ON render_jobs (status) WHERE status IN ('QUEUED','PROCESSING');

COMMIT;
