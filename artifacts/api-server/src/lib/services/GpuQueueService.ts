import pg from 'pg';

const { Pool } = pg;

const STALE_MS = 60_000;

function pool(): pg.Pool {
  const conn = process.env.QUEUE_DATABASE_URL || process.env.DATABASE_URL
    || 'postgresql://kayan:kayan_queue_52741@127.0.0.1:5432/kayan';
  return new Pool({ connectionString: conn, max: 5 });
}

let _pool: pg.Pool | null = null;
function db(): pg.Pool {
  if (!_pool) _pool = pool();
  return _pool;
}

export type JobKind = 'VIDEO_JOB' | 'LLM_JOB' | 'LIP_SYNC_JOB';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface JobRow {
  id: string;
  kind: JobKind;
  status: JobStatus;
  payload: any;
  result: any;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  heartbeat_at: Date | null;
  attempts: number;
}

export class GpuQueueService {
  /** Enqueue always succeeds — returns QUEUED id. */
  static async enqueue(kind: JobKind, payload: object): Promise<{ id: string; status: JobStatus }> {
    const r = await db().query<{ id: string; status: JobStatus }>(
      `INSERT INTO gpu_jobs (kind, payload) VALUES ($1, $2) RETURNING id, status`,
      [kind, JSON.stringify(payload)]
    );
    return r.rows[0];
  }

  static async getJob(id: string): Promise<JobRow | null> {
    const r = await db().query<JobRow>(`SELECT * FROM gpu_jobs WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }

  /** Atomic lock. Returns true iff granted. */
  static async tryAcquireLock(jobId: string, kind: JobKind): Promise<boolean> {
    const r = await db().query(
      `UPDATE gpu_lock
          SET holder_job_id=$1, holder_kind=$2,
              acquired_at=now(), heartbeat_at=now()
        WHERE id=1
          AND (holder_job_id IS NULL
               OR heartbeat_at < now() - ($3 || ' milliseconds')::interval)
        RETURNING holder_job_id`,
      [jobId, kind, STALE_MS]
    );
    return r.rowCount === 1;
  }

  static async releaseLock(jobId: string): Promise<void> {
    await db().query(
      `UPDATE gpu_lock
          SET holder_job_id=NULL, holder_kind=NULL,
              acquired_at=NULL, heartbeat_at=NULL
        WHERE id=1 AND holder_job_id=$1`,
      [jobId]
    );
  }

  static async heartbeat(jobId: string): Promise<void> {
    await db().query(
      `UPDATE gpu_jobs SET heartbeat_at=now() WHERE id=$1 AND status='RUNNING'`,
      [jobId]
    );
    await db().query(
      `UPDATE gpu_lock SET heartbeat_at=now() WHERE id=1 AND holder_job_id=$1`,
      [jobId]
    );
  }

  static async markRunning(jobId: string): Promise<void> {
    await db().query(
      `UPDATE gpu_jobs
          SET status='RUNNING', started_at=now(),
              heartbeat_at=now(), attempts=attempts+1
        WHERE id=$1 AND status='QUEUED'`,
      [jobId]
    );
  }

  static async markCompleted(jobId: string, result: object): Promise<void> {
    await db().query(
      `UPDATE gpu_jobs
          SET status='COMPLETED', result=$2, finished_at=now(), error=NULL
        WHERE id=$1 AND status='RUNNING'`,
      [jobId, JSON.stringify(result)]
    );
  }

  static async markFailed(jobId: string, error: string): Promise<void> {
    await db().query(
      `UPDATE gpu_jobs
          SET status='FAILED', error=$2, finished_at=now()
        WHERE id=$1 AND status='RUNNING'`,
      [jobId, error.slice(0, 2000)]
    );
  }

  /** FIFO next QUEUED (oldest first). */
  static async nextQueued(): Promise<JobRow | null> {
    const r = await db().query<JobRow>(
      `SELECT * FROM gpu_jobs WHERE status='QUEUED'
        ORDER BY created_at ASC LIMIT 1`
    );
    return r.rows[0] ?? null;
  }

  /** Boot recovery: stale RUNNING -> FAILED, stale lock -> freed. */
  static async recoverStale(): Promise<{ failedJobs: number; lockFreed: boolean }> {
    const j = await db().query(
      `UPDATE gpu_jobs
          SET status='FAILED',
              error='recovered: worker heartbeat stale',
              finished_at=now()
        WHERE status='RUNNING'
          AND (heartbeat_at IS NULL
               OR heartbeat_at < now() - ($1 || ' milliseconds')::interval)`,
      [STALE_MS]
    );
    const l = await db().query(
      `UPDATE gpu_lock
          SET holder_job_id=NULL, holder_kind=NULL,
              acquired_at=NULL, heartbeat_at=NULL
        WHERE id=1
          AND holder_job_id IS NOT NULL
          AND (heartbeat_at IS NULL
               OR heartbeat_at < now() - ($1 || ' milliseconds')::interval)`,
      [STALE_MS]
    );
    return { failedJobs: j.rowCount ?? 0, lockFreed: (l.rowCount ?? 0) > 0 };
  }

  /**
   * KAYAN-FIX-01 — Watchdog for stuck RUNNING jobs.
   * A job is stale if status=RUNNING and last heartbeat (or started_at if
   * heartbeat_at is NULL) is older than maxAgeMs. Converts to FAILED with
   * a fixed error tag. Also frees gpu_lock if it was held by a stale job.
   */
  static async watchdogStaleRunning(maxAgeMs = 300_000): Promise<{ failedJobs: number; lockFreed: boolean }> {
    const j = await db().query(
      `UPDATE gpu_jobs
          SET status='FAILED',
              error='stale_job_no_heartbeat',
              finished_at=now()
        WHERE status='RUNNING'
          AND COALESCE(heartbeat_at, started_at, created_at)
              < now() - ($1 || ' milliseconds')::interval`,
      [maxAgeMs]
    );
    const l = await db().query(
      `UPDATE gpu_lock
          SET holder_job_id=NULL, holder_kind=NULL,
              acquired_at=NULL, heartbeat_at=NULL
        WHERE id=1
          AND holder_job_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM gpu_jobs
             WHERE id = gpu_lock.holder_job_id AND status='RUNNING'
          )`
    );
    return { failedJobs: j.rowCount ?? 0, lockFreed: (l.rowCount ?? 0) > 0 };
  }
}
