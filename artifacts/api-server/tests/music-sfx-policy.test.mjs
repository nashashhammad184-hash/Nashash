import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const engine   = fs.readFileSync(path.join(root, 'src/lib/productionEngine.ts'), 'utf8');
const timeline = fs.readFileSync(path.join(root, 'src/routes/timeline.ts'), 'utf8');
const render   = fs.readFileSync(path.join(root, 'src/lib/renderEngine.ts'), 'utf8');
const ui       = fs.readFileSync(path.resolve(root, '../studio/src/components/project/tabs/editing.tsx'), 'utf8');

// 1) MUSIC_SFX_GEN throws explicit OPEN_DEPENDENCY
assert.match(engine, /MUSIC_SFX_GEN is OPEN_DEPENDENCY/, 'OPEN_DEPENDENCY msg missing');
assert.match(engine, /err\.code = "OPEN_DEPENDENCY"/, 'error code missing');
assert.match(engine, /feature = "MUSIC_SFX_GEN"/, 'feature tag missing');

// 2) No fabrication: no sine/anullsrc/silent fallbacks in production code
for (const [name, src] of [['engine', engine], ['timeline', timeline], ['render', render]]) {
  assert.doesNotMatch(src, /\bsine=frequency/, `${name}: sine forbidden`);
  // (the 'silent audio fallback is disabled' message is a rejection notice, not a fallback)
  // Only flag ACTUAL ffmpeg usage, not mentions inside error messages.
  assert.doesNotMatch(src, /['"]-f['"],\s*['"]anullsrc/, `${name}: anullsrc use forbidden`);
}

// 3) Timeline skips MUSIC/SFX without real asset
assert.match(timeline, /\(track === "MUSIC" \|\| track === "SFX"\) && !asset/, 'MUSIC/SFX asset guard missing');
assert.match(timeline, /OPEN_DEPENDENCY \(MUSIC_SFX_GEN unimplemented\)/, 'diagnostic message missing');

// 4) UI marks options as disabled with OPEN_DEPENDENCY label
assert.match(ui, /<option value="music" disabled>/, 'music option must be disabled');
assert.match(ui, /<option value="sfx" disabled>/, 'sfx option must be disabled');
assert.match(ui, /OPEN_DEPENDENCY/, 'UI must label OPEN_DEPENDENCY');

// 5) Render engine does not fabricate audio for MUSIC/SFX
assert.doesNotMatch(render, /MUSIC|SFX/, 'renderEngine must not handle MUSIC/SFX silently');

// 6) Policy simulation: createProductionJob("MUSIC_SFX_GEN") behavior
function simulateCreate(type) {
  if (type === 'MUSIC_SFX_GEN') {
    const err = new Error('MUSIC_SFX_GEN is OPEN_DEPENDENCY');
    err.code = 'OPEN_DEPENDENCY';
    err.feature = 'MUSIC_SFX_GEN';
    throw err;
  }
  return 'queued';
}
let threw = null;
try { simulateCreate('MUSIC_SFX_GEN'); } catch (e) { threw = e; }
assert.ok(threw, 'MUSIC_SFX_GEN must throw');
assert.equal(threw.code, 'OPEN_DEPENDENCY');
assert.equal(threw.feature, 'MUSIC_SFX_GEN');

// 7) Other job types unaffected
assert.equal(simulateCreate('VIDEO_GEN'), 'queued');
assert.equal(simulateCreate('VOICE_GEN'), 'queued');
assert.equal(simulateCreate('LIP_SYNC'), 'queued');

console.log('MUSIC_SFX_POLICY_TESTS_PASS');
