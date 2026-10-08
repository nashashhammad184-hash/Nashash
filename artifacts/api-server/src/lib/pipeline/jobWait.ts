/**
 * KAYAN-TASK-36: bounded wait with worker-failure detection.
 *
 * Used by executePipeline to await a child job (VIDEO_GEN / VOICE_GEN /
 * LIP_SYNC) with two independent limits:
 *
 *   1. Overall timeout (WAIT_TIMEOUT_MS env, default 150 min).
 *   2. Stale-worker detection: while the job is 'processing', if its
 *      updatedAt does not advance for > WORKER_STALE_MS (default 10 min),
 *      we mark it WORKER_TIMEOUT and return immediately.
 *
 * On either limit, the job is transitioned to 'failed' with an explicit
 * WORKER_TIMEOUT error tag — unless it already reached a terminal state.
 * Never creates a duplicate child job; providerJobId is preserved so a
 * subsequent Resume/rebuild cannot blindly re-submit to a provider that
 * already accepted the work (TASK-31).
 */
import { getProductionJob, markJobWorkerTimeout } from "../productionEngine";

export function waitTimeoutMs(): number {
  const v = Number(process.env.WAIT_TIMEOUT_MS || "");
  return Number.isFinite(v) && v > 0 ? v : 150 * 60 * 1000;
}

export function workerStaleMs(): number {
  const v = Number(process.env.WORKER_STALE_MS || "");
  return Number.isFinite(v) && v > 0 ? v : 10 * 60 * 1000;
}

export interface WaitForJobOptions {
  timeoutMs?: number;
  staleMs?: number;
  pollIntervalMs?: number;
  /** Injectable for tests — must return a job row or undefined. */
  getJob?: (id: string) => Promise<any>;
  /** Injectable for tests — called when a timeout/stale transition happens. */
  onTimeout?: (id: string, reason: string) => Promise<void>;
}

export async function waitForJob(jobId: string, opts: WaitForJobOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? waitTimeoutMs();
  const staleMs = opts.staleMs ?? workerStaleMs();
  const pollMs = opts.pollIntervalMs ?? 2000;
  const getJob = opts.getJob ?? getProductionJob;
  const onTimeout = opts.onTimeout ?? markJobWorkerTimeout;

  const deadline = Date.now() + timeoutMs;
  let lastTouch = Date.now();

  while (Date.now() < deadline) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`job ${jobId} disappeared`);
    if (job.status === "completed" || job.status === "failed") return job;

    const u = job.updatedAt instanceof Date
      ? job.updatedAt.getTime()
      : new Date(job.updatedAt as any).getTime();
    if (Number.isFinite(u) && u > lastTouch) lastTouch = u;

    if (Date.now() - lastTouch > staleMs) {
      await onTimeout(jobId, `no progress for ${Math.round((Date.now() - lastTouch) / 1000)}s`);
      const after = await getJob(jobId);
      if (after) return after;
      throw new Error(`job ${jobId} WORKER_TIMEOUT (disappeared after marking)`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  await onTimeout(jobId, `overall wait timeout after ${timeoutMs}ms`);
  const after = await getJob(jobId);
  if (after) return after;
  throw new Error(`job ${jobId} timed out after ${timeoutMs}ms`);
}
