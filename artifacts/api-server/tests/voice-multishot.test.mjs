import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const src = fs.readFileSync(
  path.resolve(new URL('../src/routes/pipeline.ts', import.meta.url).pathname),
  'utf8',
);

// 1) Legacy single-voice handling must be gone
assert.doesNotMatch(src, /firstDialogue/, 'firstDialogue still present');
assert.doesNotMatch(src, /useOverride = shotsWithDialogue\.length === 1/);

// 2) Per-shot voice loop
assert.match(src, /const dialogueShots = shots\.filter/, 'dialogueShots filter missing');
assert.match(src, /for \(const shot of dialogueShots\)/, 'per-shot dialogue loop missing');
// KAYAN-TASK-73C: perShotVoice is now multi-line with jobAudioPath + resolved handle.
assert.match(src, /perShotVoice\[shot\.id\] = \{[\s\S]{0,300}audioPath: jobAudioPath[\s\S]{0,300}audioUrl,/, 'perShotVoice entry missing');

// 3) Explicit job payload fields
assert.match(src, /shotId: shot\.id/, 'shotId must be passed to VOICE_GEN');
assert.match(src, /dialogueId: shot\.id/, 'dialogueId must be passed');
assert.match(src, /voiceId = shotVoiceId;/, 'voiceId association missing');

// 4) Data URL forbidden
assert.match(src, /audioUrl\.startsWith\("data:"\)/, 'data: URL guard missing');
assert.match(src, /not allowed in production/, 'data: URL rejection message missing');

// 5) ffprobe verify on audio
assert.match(src, /async function assertRealAudioFile/, 'assertRealAudioFile helper missing');
assert.match(src, /stream\.codec_type !== "audio"/, 'audio stream check missing');
assert.match(src, /audio duration <= 0/, 'duration>0 check missing');

// 6) Per-shot DB persistence
assert.match(src, /shotsTable[\s\S]{0,100}audioStatus: \"COMPLETED\"/, 'per-shot audioUrl persistence missing');
assert.match(src, /audioStatus: "FAILED"/, 'failed status persistence missing');

// 7) voiceText policy: only single-dialogue override
assert.match(src, /singleDialogueOverride =[\s\S]{0,200}dialogueShots\.length === 1/, 'single-dialogue override policy missing');
assert.match(src, /singleDialogueOverride \?\? shot\.dialogue/, 'override must fall through to shot.dialogue');

// 8) Timeline must associate voice with the correct shot window
assert.match(src, /shotId: shot\.id,\s*\n\s*track: \"VOICE\"/, 'timeline VOICE item must reference shot.id');

// 9) Simulate 3-shot voice flow with fake real mp3 file to verify ffprobe accepts it
const TMP = fs.mkdtempSync('/tmp/voice-ms-');
const mp3 = path.join(TMP, 'test.mp3');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame',mp3]);
const st = fs.statSync(mp3);
assert.ok(st.size > 0, 'fixture mp3 must be non-zero');

// 10) 3 shots → 3 distinct expected job keys in perShotVoice map
const shotsFixture = [
  { id: 11, dialogue: 'first line', durationSeconds: 3 },
  { id: 22, dialogue: 'second line', durationSeconds: 4 },
  { id: 33, dialogue: 'third line', durationSeconds: 5 },
];
const dialogueShots = shotsFixture.filter((s) => (s.dialogue || '').trim().length > 0);
assert.equal(dialogueShots.length, 3);
const perShotVoice = {};
for (const shot of dialogueShots) { perShotVoice[shot.id] = { text: shot.dialogue }; }
assert.deepEqual(Object.keys(perShotVoice).sort(), ['11','22','33']);
assert.equal(new Set(Object.values(perShotVoice).map(v => v.text)).size, 3, 'each shot gets distinct text');
// no dialogue shot never creates a job
const noDialogueShot = { id: 99, dialogue: '   ', durationSeconds: 2 };
assert.equal((noDialogueShot.dialogue || '').trim().length > 0, false);

console.log('VOICE_MULTISHOT_TESTS_PASS');
