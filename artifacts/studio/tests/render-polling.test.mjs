import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(new URL('../src/components/project/tabs/editing.tsx', import.meta.url).pathname),
  'utf8',
);

assert.doesNotMatch(src, /setRenderProgress\(100\);\s*setRenderStatus\("COMPLETED"\);\s*setFinalMp4Url\(data\.outputVideoUrl\)/, 'old immediate-complete pattern still present');
assert.doesNotMatch(src, /response\.ok && data\.success[\s\S]{0,100}setRenderStatus\("COMPLETED"\)/, 'no instant COMPLETED after POST');
assert.match(src, /\/api\/render\/status\/\$\{jobId\}/, 'must poll /api/render/status/:jobId');
assert.match(src, /setTimeout\(tick, 3000\)/, 'poll interval missing');
assert.match(src, /st === "QUEUED" \|\| st === "PROCESSING"/, 'QUEUED/PROCESSING branch missing');
assert.match(src, /st === "COMPLETED"/, 'COMPLETED branch missing');
assert.match(src, /st === "FAILED"/, 'FAILED branch missing');
assert.match(src, /Render job COMPLETED but no outputUrl/, 'missing no-outputUrl guard');
assert.match(src, /refusing to mark success/, 'missing refusal');
assert.match(src, /catch \(e: any\)[\s\S]{0,200}setRenderError/, 'network error must set error, not COMPLETED');
assert.doesNotMatch(src, /catch[\s\S]{0,100}setRenderStatus\("COMPLETED"\)/, 'catch must not mark COMPLETED');
assert.match(src, /cancelled = true; if \(timer\) clearTimeout\(timer\)/, 'cleanup missing');
assert.match(src, /data\.jobId/, 'jobId must come from backend');
assert.doesNotMatch(src, /outputVideoUrl[\s\S]{0,50}setRenderStatus\("COMPLETED"\)/, 'outputVideoUrl alone must not complete');

function simulate(events) {
  let status = 'PROCESSING', progress = 0, url = null, err = null;
  const eventsCopy = events.slice();
  status = 'QUEUED'; progress = 0;
  while (eventsCopy.length) {
    const e = eventsCopy.shift();
    if (e.network) { err = 'network error'; continue; }
    const st = (e.status || '').toUpperCase();
    if (st === 'QUEUED' || st === 'PROCESSING') { status = st; if (st==='PROCESSING') progress = 50; continue; }
    if (st === 'COMPLETED') {
      if (!e.outputUrl) { status = 'FAILED'; err = 'no outputUrl'; return { status, progress: 0, url, err }; }
      status = 'COMPLETED'; progress = 100; url = e.outputUrl; return { status, progress, url, err };
    }
    if (st === 'FAILED') { status = 'FAILED'; err = e.error || 'FAILED'; return { status, progress, url, err }; }
  }
  return { status, progress, url, err };
}

assert.deepEqual(simulate([{status:'QUEUED'},{status:'PROCESSING'},{status:'COMPLETED', outputUrl:'/uploads/renders/x.mp4'}]), { status:'COMPLETED', progress:100, url:'/uploads/renders/x.mp4', err:null });
assert.deepEqual(simulate([{status:'PROCESSING'},{status:'FAILED', error:'boom'}]), { status:'FAILED', progress:50, url:null, err:'boom' });
assert.deepEqual(simulate([{status:'PROCESSING'},{status:'COMPLETED'}]), { status:'FAILED', progress:0, url:null, err:'no outputUrl' });

const postIdx = src.indexOf('handleStartFinalRender');
const postBlock = src.slice(postIdx, postIdx + 1500);
assert.doesNotMatch(postBlock, /setRenderStatus\("COMPLETED"\)/, 'post-sync block must not set COMPLETED');

console.log('RENDER_POLLING_TESTS_PASS');
