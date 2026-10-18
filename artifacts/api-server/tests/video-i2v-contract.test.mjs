import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const route = fs.readFileSync(path.join(root, 'src/routes/video.ts'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/lib/productionEngine.ts'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'src/lib/kayanGpuProvider.ts'), 'utf8');
const openapi = fs.readFileSync(path.resolve(root, '../../lib/api-spec/openapi.yaml'), 'utf8');

// OpenAPI source of truth has I2V fields
for (const f of ['task','referenceImageBase64','negativePrompt','fps','durationSeconds','numFrames','aspectRatio','seed','resolution','steps']) {
  assert.match(openapi, new RegExp(`\\b${f}\\b`), `openapi missing field ${f}`);
}

// Route passes every field
for (const f of ['task: __task','referenceImageBase64: __d.referenceImageBase64','negativePrompt: __d.negativePrompt','fps: __d.fps','durationSeconds: __d.durationSeconds','numFrames: __d.numFrames','aspectRatio: __d.aspectRatio','seed: __d.seed','resolution: __d.resolution','steps: __d.steps']) {
  assert.ok(route.includes(f), `route missing passthrough: ${f}`);
}

// Route validates I2V before dispatch
assert.match(route, /i2v requires referenceImageBase64/, 'i2v validation missing');
assert.match(route, /numFrames=.*violates/, 'numFrames validation missing');
assert.match(route, /durationSeconds out of range/, 'duration validation missing');

// Engine forwards seed/resolution/steps
assert.match(engine, /seed: \(job\.payload as any\)\.seed/);
assert.match(engine, /resolution: \(job\.payload as any\)\.resolution/);
assert.match(engine, /steps: \(job\.payload as any\)\.steps/);

// Provider still honors I2V
assert.match(provider, /task === "i2v"/);
assert.match(provider, /referenceImageBase64/);

console.log('VIDEO_I2V_CONTRACT_TESTS_PASS');
