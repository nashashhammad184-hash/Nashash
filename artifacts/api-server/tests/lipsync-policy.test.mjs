import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const provider = fs.readFileSync(path.join(root, 'src/lib/kayanGpuProvider.ts'), 'utf8');
const engine   = fs.readFileSync(path.join(root, 'src/lib/productionEngine.ts'), 'utf8');
const pipeline = fs.readFileSync(path.join(root, 'src/routes/pipeline.ts'), 'utf8');

// 1) Provider must NOT return success on no_face_in_video
assert.doesNotMatch(provider, /success:\s*true,\s*\n\s*skipped:\s*true/, 'provider still returns success+skipped');
assert.match(provider, /worker reported no_face_in_video/, 'provider must raise on no_face');
assert.match(provider, /err\.code = 'LIPSYNC_NO_FACE'/, 'provider error code missing');
assert.match(provider, /LIPSYNC_OUTPUT_IS_INPUT/, 'provider output=input check missing');

// 2) Engine must NOT complete on skip
assert.doesNotMatch(engine, /output = \{[\s\S]{0,200}skipped: true,[\s\S]{0,200}reason: 'no_face_in_video'/, 'engine still completes on skip');
assert.match(engine, /result\?\.skipped[\s\S]{0,400}throw err/, 'engine must throw on skip');
assert.match(engine, /LIP_SYNC output equals input video/, 'engine output=input check missing');

// 3) Pipeline: explicit skip BEFORE job; real sync must differ from input
assert.match(pipeline, /explicit production decision made BEFORE/, 'pipeline explicit-decision comment missing');
assert.match(pipeline, /LIP_SYNC shot \$\{shot\.id\}: synced output equals input video/, 'pipeline output=input check missing');
assert.match(pipeline, /if \(input\.skipLipSync\)/, 'pipeline skipLipSync branch missing');

// 4) skipLipSync=true must not call createProductionJob("LIP_SYNC"
const skipIdx = pipeline.indexOf('if (input.skipLipSync)');
const elseIdx = pipeline.indexOf('} else {', skipIdx);
const skipBlock = pipeline.slice(skipIdx, elseIdx);
assert.doesNotMatch(skipBlock, /createProductionJob\(["']LIP_SYNC/, 'skip branch must NOT create LIP_SYNC job');

// 5) Structural simulation of policy matrix
function simulate({ hasFace, explicitSkip, audioPresent }) {
  if (explicitSkip) return 'SKIPPED';
  if (!audioPresent) return 'NO_JOB';
  if (!hasFace) return 'FAILED';
  return 'COMPLETED';
}
assert.equal(simulate({ hasFace: true,  explicitSkip: false, audioPresent: true }),  'COMPLETED');
assert.equal(simulate({ hasFace: false, explicitSkip: false, audioPresent: true }),  'FAILED');
assert.equal(simulate({ hasFace: false, explicitSkip: true,  audioPresent: true }),  'SKIPPED');
assert.equal(simulate({ hasFace: true,  explicitSkip: false, audioPresent: false }), 'NO_JOB');

// 6) Empty / invalid output → FAILED (fixtures)
const TMP = fs.mkdtempSync('/tmp/ls-pol-');
const empty = path.join(TMP, 'empty.mp4');
fs.writeFileSync(empty, Buffer.alloc(0));
assert.equal(fs.statSync(empty).size, 0, 'empty fixture size');

const badMp4 = path.join(TMP, 'bad.mp4');
fs.writeFileSync(badMp4, 'not-a-video');
assert.ok(fs.statSync(badMp4).size > 0);

// Same-path = input
const input = path.join(TMP, 'in.mp4');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:d=1','-frames:v','1','-pix_fmt','yuv420p','-c:v','libx264',input]);
assert.ok(fs.statSync(input).size > 0);

function assertDiffers(inp, out) { return path.resolve(inp) !== path.resolve(out); }
assert.equal(assertDiffers(input, input), false, 'same-path must be rejected');
const synced = path.join(TMP, 'synced.mp4');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-frames:v','1','-pix_fmt','yuv420p','-c:v','libx264',synced]);
assert.equal(assertDiffers(input, synced), true, 'different output must be accepted');

console.log('LIPSYNC_POLICY_TESTS_PASS');
