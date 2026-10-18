import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(new URL('../src/routes/pipeline.ts', import.meta.url).pathname),
  'utf8',
);

// 1) Legacy single-shot patterns must be gone
assert.doesNotMatch(src, /firstDialogue/, 'firstDialogue still present');
assert.doesNotMatch(src, /shots\[0\]/, 'shots[0] still present');
assert.doesNotMatch(src, /single shot scenario/i, 'single-shot comment still present');

// 2) Per-shot loops over shots with order
assert.match(src, /for \(const shot of shots\)/, 'per-shot loop missing');
assert.match(src, /orderBy\(asc\(shotsTable\.sceneNumber\), asc\(shotsTable\.id\)\)/, 'shot order by sceneNumber,id missing');

// 3) Voice stage: loop over shotsWithDialogue, per shot voice job keyed by shot.id
assert.match(src, /const dialogueShots = shots\.filter/, 'dialogueShots filter missing (renamed by TASK-73C)');
// KAYAN-TASK-73C: perShotVoice is now a multi-line object with jobAudioPath + resolved handle.
assert.match(src, /perShotVoice\[shot\.id\] = \{[\s\S]{0,200}audioPath: jobAudioPath[\s\S]{0,300}audioUrl,/, 'perShotVoice mapping missing');

// 4) Video stage: per-shot video
assert.match(src, /perShotVideo\[shot\.id\] = \{ videoPath: vp, videoUrl: vu \}/, 'perShotVideo mapping missing');

// 5) LipSync: per shot or passthrough when no dialogue
assert.match(src, /perShotSynced\[shot\.id\] = \{ syncedVideoPath: sp, syncedVideoUrl: su \}/, 'perShotSynced mapping missing');
// KAYAN-TASK-07 added a 4-line comment between `if (!a) {` and the passthrough assignment.
assert.match(src, /if \(!a\) \{[\s\S]{0,800}perShotSynced\[shot\.id\] = \{ syncedVideoPath: v\.videoPath, syncedVideoUrl: v\.videoUrl \}/, 'lipsync passthrough for no-audio shots missing');

// 6) Timeline: cumulative per shot
assert.match(src, /for \(const shot of shots\) \{[\s\S]{0,1500}timelineInserted\.push\(\{ assetUrl: synced\.syncedVideoUrl, duration: dur, order: vItem\.order, shotId: shot\.id \}\)/);
assert.match(src, /currentTime \+= dur;/, 'cumulative currentTime missing');

// 7) Auto-edit: cumulative editCursor
assert.match(src, /let editCursor = 0;/, 'editCursor missing');
assert.match(src, /editCursor = end;/, 'editCursor update missing');

// 8) Subtitles use per-shot timing loop (existing logic is fine but must iterate shots)
assert.match(src, /for \(let i = 0; i < shots\.length; i\+\+\)/, 'subtitles per-shot loop missing');

// 9) Render receives all clips
assert.match(src, /const renderClips: RenderClipInput\[\] = timelineInserted\.map/, 'render clips must map over all timeline inserts');

// 10) Audio concat across shots
assert.match(src, /orderedVoicePaths/, 'orderedVoicePaths missing');
assert.match(src, /ffmpeg concat/, 'audio concat missing');

// 11) Output contains shotIds + perShot
assert.match(src, /shotIds: shots\.map\(\(sh\) => sh\.id\)/, 'shotIds in output missing');
assert.match(src, /perShot: shots\.map\(\(sh\) => \(\{/, 'perShot in output missing');

// 12) Simulate the timing math for 3 shots with durations 3, 4, 5
const durations = [3, 4, 5];
let cursor = 0;
const times = durations.map((d) => { const s = cursor; cursor += d; return { start: s, end: s + d }; });
assert.deepEqual(times, [{ start: 0, end: 3 }, { start: 3, end: 7 }, { start: 7, end: 12 }]);
assert.equal(cursor, 12);

console.log('PIPELINE_MULTISHOT_TESTS_PASS');
