import assert from 'node:assert/strict';
import { parseAndValidateScript, extractJson, GeneratedScriptSchema } from '../src/lib/scriptSchema.ts';

// 1) valid JSON → pass
const valid = {
  title: "The Test",
  scenes: [{
    sceneNumber: 1, sceneTitle: "Opening", visualDescription: "Wide shot",
    characterDialogue: "Hello", backingScorePrompt: "calm",
    audioMusic: "strings", englishSubtitles: "Hello",
    shots: [{
      shotOrder: 1, description: "Camera opens", cameraMovement: "push in",
      durationSeconds: 4, dialogue: "Hi", audioNote: "ambient"
    }]
  }]
};
assert.deepEqual(parseAndValidateScript(JSON.stringify(valid)).title, "The Test");

// 2) fenced JSON → pass
const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
assert.deepEqual(parseAndValidateScript(fenced).title, "The Test");

// 3) prose-wrapped JSON → pass (extracted)
const prose = "Sure! Here is your script:\n" + JSON.stringify(valid) + "\nEnjoy!";
assert.deepEqual(parseAndValidateScript(prose).title, "The Test");

// 4) malformed JSON → fail
assert.throws(() => parseAndValidateScript("{not valid json"), /SCRIPT_PARSE_FAILED/);

// 5) empty → fail
assert.throws(() => parseAndValidateScript(""), /SCRIPT_PARSE_FAILED/);
assert.throws(() => parseAndValidateScript("   "), /SCRIPT_PARSE_FAILED/);

// 6) missing required field → fail
const missingTitle = { scenes: valid.scenes };
assert.throws(() => parseAndValidateScript(JSON.stringify(missingTitle)), /SCRIPT_VALIDATION_FAILED/);

// 7) wrong type → fail
const wrongType = { ...valid, title: 42 };
assert.throws(() => parseAndValidateScript(JSON.stringify(wrongType)), /SCRIPT_VALIDATION_FAILED/);

// 8) empty shots → fail (scene must have >= 1 shot)
const emptyShots = {
  title: "X",
  scenes: [{ ...valid.scenes[0], shots: [] }]
};
assert.throws(() => parseAndValidateScript(JSON.stringify(emptyShots)), /SCRIPT_VALIDATION_FAILED/);

// 9) non-integer shotOrder → fail
const badOrder = {
  title: "X",
  scenes: [{ ...valid.scenes[0], shots: [{ ...valid.scenes[0].shots[0], shotOrder: 1.5 }] }]
};
assert.throws(() => parseAndValidateScript(JSON.stringify(badOrder)), /SCRIPT_VALIDATION_FAILED/);

// 10) negative durationSeconds → fail
const badDur = {
  title: "X",
  scenes: [{ ...valid.scenes[0], shots: [{ ...valid.scenes[0].shots[0], durationSeconds: -1 }] }]
};
assert.throws(() => parseAndValidateScript(JSON.stringify(badDur)), /SCRIPT_VALIDATION_FAILED/);

// 11) zero scenes → fail
assert.throws(
  () => parseAndValidateScript(JSON.stringify({ title: "X", scenes: [] })),
  /SCRIPT_VALIDATION_FAILED/
);

// 12) > 8 scenes → fail (contract cap)
const many = { title: "X", scenes: Array(9).fill(valid.scenes[0]) };
assert.throws(() => parseAndValidateScript(JSON.stringify(many)), /SCRIPT_VALIDATION_FAILED/);

// 13) optional fields default to "" (schema fills them)
const noOpt = {
  title: "T",
  scenes: [{
    sceneNumber: 1, sceneTitle: "s", visualDescription: "v",
    shots: [{ shotOrder: 1, description: "d", cameraMovement: "c", durationSeconds: 3 }]
  }]
};
const filled = parseAndValidateScript(JSON.stringify(noOpt));
assert.equal(filled.scenes[0].characterDialogue, "");
assert.equal(filled.scenes[0].shots[0].dialogue, "");
assert.equal(filled.scenes[0].shots[0].audioNote, "");

// 14) downstream fixture: validated output maps to shot rows (simulating ScriptJobRunner)
const shotRows = [];
for (const scene of filled.scenes) {
  for (const shot of scene.shots) {
    if (!shot.description || !shot.description.trim()) continue;
    shotRows.push({
      sceneNumber: String(scene.sceneNumber || '1'),
      description: shot.description.trim(),
      cameraMovement: shot.cameraMovement || 'Cinematic slow push-in',
      durationSeconds: shot.durationSeconds > 0 ? Math.round(shot.durationSeconds) : 5,
      dialogue: shot.dialogue || null,
      audioNote: shot.audioNote || null,
    });
  }
}
assert.equal(shotRows.length, 1);
assert.equal(shotRows[0].sceneNumber, "1");
assert.equal(shotRows[0].description, "d");

// 15) extractJson handles no-brace content gracefully (parse will then fail cleanly)
assert.equal(extractJson("hello"), "hello");
assert.throws(() => parseAndValidateScript("hello"), /SCRIPT_PARSE_FAILED/);

// 16) schema exports stable
assert.ok(GeneratedScriptSchema);

console.log('SCRIPT_CONTRACT_TESTS_PASS');
