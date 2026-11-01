import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { GeneratedShotSchema } from '../src/lib/scriptSchema';

function applyFallback(shot: any) {
  return (shot.dialogue && shot.dialogue.trim().length >= 5)
    ? shot.dialogue.trim()
    : `Silent scene: ${shot.description.slice(0, 100)}`;
}

test('KAYAN-14 Dialogue Required Tests', async (t) => {
  await t.test('A1: Valid dialogue (5+ chars)', () => {
    const res = GeneratedShotSchema.safeParse({ shotOrder: 1, description: 'test', cameraMovement: 'static', durationSeconds: 5, dialogue: 'Hello world', audioNote: '' });
    assert.equal(res.success, true);
  });

  await t.test('A2: Empty dialogue -> fail', () => {
    const res = GeneratedShotSchema.safeParse({ shotOrder: 1, description: 'test', cameraMovement: 'static', durationSeconds: 5, dialogue: '', audioNote: '' });
    assert.equal(res.success, false);
  });

  await t.test('A3: Missing dialogue -> fail', () => {
    const res = GeneratedShotSchema.safeParse({ shotOrder: 1, description: 'test', cameraMovement: 'static', durationSeconds: 5, audioNote: '' });
    assert.equal(res.success, false);
  });

  await t.test('A4: Short dialogue (4 chars) -> fail', () => {
    const res = GeneratedShotSchema.safeParse({ shotOrder: 1, description: 'test', cameraMovement: 'static', durationSeconds: 5, dialogue: 'Hel', audioNote: '' });
    assert.equal(res.success, false);
  });

  await t.test('B1: Fallback logic on empty dialogue', () => {
    const result = applyFallback({ description: 'Wide shot', dialogue: '' });
    assert.equal(result, 'Silent scene: Wide shot');
  });

  await t.test('B2: Fallback logic on missing dialogue', () => {
    const result = applyFallback({ description: 'Close up', dialogue: null });
    assert.equal(result, 'Silent scene: Close up');
  });

  await t.test('B3: Valid dialogue remains unchanged', () => {
    const result = applyFallback({ description: 'test', dialogue: 'Valid dialogue' });
    assert.equal(result, 'Valid dialogue');
  });
});