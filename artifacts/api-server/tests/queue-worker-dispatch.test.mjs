import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../src/queue-worker.ts', import.meta.url), 'utf8');

assert.match(src, /case\s+'VIDEO_JOB':\s*\n\s*result\s*=\s*await runVideoJob\(next\)/, 'VIDEO_JOB branch missing');
assert.match(src, /case\s+'LLM_JOB':\s*\n\s*result\s*=\s*await runLlmJob\(next\)/, 'LLM_JOB branch missing');
assert.match(src, /case\s+'LIP_SYNC_JOB':\s*\n\s*result\s*=\s*await runLipSyncJob\(next\)/, 'LIP_SYNC_JOB branch missing');
assert.match(src, /default:\s*\n\s*throw new Error\(`Unsupported GPU job kind: \$\{next\.kind\}`\)/, 'default must throw Unsupported');
assert.doesNotMatch(src, /next\.kind === 'VIDEO_JOB' \? await runVideoJob\(next\) : await runLlmJob\(next\)/, 'old ternary fallback still present');
assert.match(src, /async function runLipSyncJob\(job\)/, 'runLipSyncJob missing');
assert.match(src, /video_path/, 'video_path not used');
assert.match(src, /audio_path/, 'audio_path not used');
assert.match(src, /\/jobs\/lipsync/, 'lipsync endpoint missing');
assert.match(src, /await GpuQueueService\.releaseLock\(next\.id\)/, 'releaseLock missing');
console.log('DISPATCH_TESTS_PASS');
