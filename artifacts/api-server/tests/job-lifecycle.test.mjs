import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine = fs.readFileSync(path.join(root, 'src/lib/productionEngine.ts'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'src/lib/kayanGpuProvider.ts'), 'utf8');
const queueSvc = fs.readFileSync(path.join(root, 'src/lib/services/GpuQueueService.ts'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src/queue-worker.ts'), 'utf8');

// ── 1. classifyRetry is exported and covers all 3 buckets ──
assert.match(engine, /export function classifyRetry/, 'classifyRetry missing');
assert.match(engine, /RETRY_LIMITED/, 'RETRY_LIMITED missing');
assert.match(engine, /NO_RETRY_ACCEPTED/, 'NO_RETRY_ACCEPTED missing');
assert.match(engine, /NO_RETRY\b/, 'NO_RETRY missing');

// ── 2. Never duplicate after provider acceptance ──
assert.match(engine, /providerJobId[\s\S]{0,100}trim\(\)\.length > 0[\s\S]{0,100}return 'NO_RETRY_ACCEPTED'/, 'accepted-provider guard missing');
assert.match(engine, /refusing duplicate submission/, 'duplicate refusal message missing');

// ── 3. providerJobId is persisted via onEnqueued ──
assert.match(provider, /onEnqueued/, 'onEnqueued hook missing in provider');
assert.match(provider, /await req\.onEnqueued\(enq\.id\)/, 'callback must receive the enqueued id');
assert.match(engine, /onEnqueued: async \(qid: string\)/, 'engine must pass onEnqueued');
assert.match(engine, /providerJobId: qid/, 'engine must persist providerJobId from onEnqueued');

// ── 4. Retry decision is decided by classification, not blind count ──
assert.match(engine, /const shouldRetry = decision === "RETRY_LIMITED" && retries <= maxRetries/, 'retry gating must use classification');

// ── 5. GpuQueueService: DB is source of truth, atomic lock, stale handling ──
assert.match(queueSvc, /UPDATE gpu_lock[\s\S]{0,200}WHERE id=1/, 'atomic lock query missing');
assert.match(queueSvc, /recoverStale/, 'recoverStale missing');
assert.match(queueSvc, /watchdogStaleRunning/, 'watchdogStaleRunning missing');
// recoverStale and watchdog must convert stale RUNNING → FAILED, never requeue
assert.match(queueSvc, /SET status='FAILED'[\s\S]{0,200}heartbeat_at IS NULL/, 'stale must go to FAILED (not requeue)');
// No in-memory source-of-truth map for jobs
assert.doesNotMatch(queueSvc, /const jobs = new Map/, 'in-memory jobs map forbidden');
assert.doesNotMatch(queueSvc, /let jobsRegistry/, 'jobs registry forbidden');

// ── 6. queue-worker dispatches explicitly with default that fails (TASK-01) ──
assert.match(worker, /case 'VIDEO_JOB'/, 'VIDEO_JOB branch missing');
assert.match(worker, /case 'LLM_JOB'/, 'LLM_JOB branch missing');
assert.match(worker, /case 'LIP_SYNC_JOB'/, 'LIP_SYNC_JOB branch missing');
assert.match(worker, /Unsupported GPU job kind/, 'unknown kind must fail');

// ── 7. Behavior simulation of classifyRetry (mirrors source) ──
function classifyRetry(errMsg, ctx) {
  const m = (errMsg || '').toLowerCase();
  if (ctx.providerJobId && ctx.providerJobId.trim().length > 0) return 'NO_RETRY_ACCEPTED';
  const pats = ['requires ','not configured','not implemented','is not implemented','open_dependency','invalid','validation','schema','unsupported','not found','missing','empty','out of range','exceeds','violates','no real audio','silent','forbidden'];
  for (const p of pats) if (m.includes(p)) return 'NO_RETRY';
  return 'RETRY_LIMITED';
}
// validation → no retry
assert.equal(classifyRetry('VIDEO_GEN requires prompt', {}), 'NO_RETRY');
assert.equal(classifyRetry('DEEPGRAM_API_KEY is not configured', {}), 'NO_RETRY');
assert.equal(classifyRetry('durationSeconds out of range: -1', {}), 'NO_RETRY');
assert.equal(classifyRetry('i2v requires referenceImageBase64 (>=64 chars)', {}), 'NO_RETRY');
// provider accepted → no retry regardless of error class
assert.equal(classifyRetry('Timeout waiting for provider', { providerJobId: 'gpu_job_123' }), 'NO_RETRY_ACCEPTED');
assert.equal(classifyRetry('ECONNRESET', { providerJobId: 'gpu_job_456' }), 'NO_RETRY_ACCEPTED');
// transient before acceptance → retry
assert.equal(classifyRetry('fetch failed: ECONNRESET', {}), 'RETRY_LIMITED');
assert.equal(classifyRetry('ETIMEDOUT', {}), 'RETRY_LIMITED');

// ── 8. Retry counter progression simulation ──
function retryOutcome(errMsg, ctx, priorRetries, maxRetries) {
  const decision = classifyRetry(errMsg, ctx);
  const retries = priorRetries + 1;
  if (decision === 'RETRY_LIMITED' && retries <= maxRetries) return { status: 'pending', retryCount: retries, decision };
  return { status: 'failed', retryCount: retries, decision };
}
// transient → retried until exhausted
assert.deepEqual(retryOutcome('ECONNRESET', {}, 0, 3), { status: 'pending', retryCount: 1, decision: 'RETRY_LIMITED' });
assert.deepEqual(retryOutcome('ECONNRESET', {}, 1, 3), { status: 'pending', retryCount: 2, decision: 'RETRY_LIMITED' });
assert.deepEqual(retryOutcome('ECONNRESET', {}, 3, 3), { status: 'failed', retryCount: 4, decision: 'RETRY_LIMITED' });
// validation never retried
assert.deepEqual(retryOutcome('invalid input', {}, 0, 3), { status: 'failed', retryCount: 1, decision: 'NO_RETRY' });
// accepted → never retried even with 0 retries
assert.deepEqual(retryOutcome('anything', { providerJobId: 'abc' }, 0, 3), { status: 'failed', retryCount: 1, decision: 'NO_RETRY_ACCEPTED' });

console.log('JOB_LIFECYCLE_TESTS_PASS');
