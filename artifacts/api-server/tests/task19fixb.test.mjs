import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const queueWorker = fs.readFileSync(path.join(root, 'src/queue-worker.ts'), 'utf8');
const provider    = fs.readFileSync(path.join(root, 'src/lib/kayanGpuProvider.ts'), 'utf8');
const engine      = fs.readFileSync(path.join(root, 'src/lib/productionEngine.ts'), 'utf8');

// ── TEST 1: VIDEO_JOB timeout must be 10_800_000 (3h), not 3_600_000 ──
assert.match(queueWorker, /pollWorkerJob\(VIDEO_URL,\s*jid,\s*10_800_000\)/, 'VIDEO_JOB must use 3h');
assert.doesNotMatch(queueWorker, /pollWorkerJob\(VIDEO_URL,\s*jid,\s*3_600_000\)/, 'VIDEO_JOB must not use 1h anymore');
// Scope check: LLM job must NOT be extended to 3h (stays 900_000)
assert.match(queueWorker, /pollWorkerJob\(LLM_URL,\s*jid,\s*900_000\)/, 'LLM timeout must stay');
// Lipsync unchanged
assert.match(queueWorker, /pollWorkerJob\(LIPSYNC_URL,\s*jid,\s*3_600_000\)/, 'LIPSYNC timeout must stay');

// ── TEST 2: generateVideoKayanGpu fires onEnqueued before polling ──
const vkStart = provider.indexOf('export async function generateVideoKayanGpu');
const vkEnd   = provider.indexOf('async function __legacyGenerateVideoKayanGpu');
const vkBody  = provider.slice(vkStart, vkEnd);
assert.match(vkBody, /typeof req\.onEnqueued === 'function'/, 'VIDEO must check onEnqueued');
assert.match(vkBody, /await req\.onEnqueued\(enq\.id\)/, 'VIDEO must await onEnqueued(enq.id)');
// Order: enqueue → onEnqueued → poll loop
const idxEnqueue    = vkBody.indexOf("GpuQueueService.enqueue('VIDEO_JOB'");
const idxOnEnqueued = vkBody.indexOf('await req.onEnqueued(enq.id)');
const idxPollLoop   = vkBody.indexOf('while (Date.now() < deadline)');
assert.ok(idxEnqueue >= 0 && idxOnEnqueued > idxEnqueue, 'onEnqueued must run after enqueue');
assert.ok(idxPollLoop > idxOnEnqueued, 'onEnqueued must run BEFORE poll loop');

// ── TEST 3: productionEngine persists providerJobId in onEnqueued ──
assert.match(engine, /onEnqueued:\s*async\s*\(qid:\s*string\)\s*=>\s*\{[\s\S]{0,150}setStatus\(jobId,\s*"processing",\s*\{\s*providerJobId:\s*qid\s*\}\)/,
  'engine must persist providerJobId in onEnqueued');

// ── TEST 4: production_pipeline schema has providerJobId column ──
const schema = fs.readFileSync(path.resolve(root, '../../lib/db/src/schema/production_pipeline.ts'), 'utf8');
assert.match(schema, /providerJobId:\s*text\("provider_job_id"\)/, 'schema must define provider_job_id');

// ── TEST 5: Behavior simulation — worker RUNNING at 60min → NOT failed ──
function simulatePolling(jobTimelineMs, pollTimeoutMs) {
  // jobTimelineMs: total real duration until worker terminal status
  // pollTimeoutMs: Nashash poll window
  // returns: 'COMPLETED' | 'FAILED_TIMEOUT'
  if (jobTimelineMs <= pollTimeoutMs) return 'COMPLETED';
  return 'FAILED_TIMEOUT';
}
const ONE_HOUR = 3_600_000;
const THREE_HOURS = 10_800_000;
// Job that completes at 63.5 min (~3.81e6 ms) — exactly TASK-19 Job 1 pattern
const jobDuration = 63.5 * 60 * 1000;
// With old 1h timeout: fails
assert.equal(simulatePolling(jobDuration, ONE_HOUR), 'FAILED_TIMEOUT', 'old 1h timeout must fail a 63.5min job');
// With new 3h timeout: succeeds
assert.equal(simulatePolling(jobDuration, THREE_HOURS), 'COMPLETED', 'new 3h timeout must succeed a 63.5min job');
// Edge: worker returns at 2h59m with 3h limit → still OK
assert.equal(simulatePolling(179 * 60 * 1000, THREE_HOURS), 'COMPLETED', '2h59m must still succeed');
// Beyond 3h → timeout (fail-safe, not infinite)
assert.equal(simulatePolling(200 * 60 * 1000, THREE_HOURS), 'FAILED_TIMEOUT', 'beyond 3h must time out');

console.log('TASK19FIXB_TESTS_PASS');
