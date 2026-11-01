import { test } from 'node:test';
import { strict as assert } from 'node:assert';

function validateShotId(input: any) {
  if (input === undefined || input === null || input === "") return { ok: true, value: undefined };
  const n = parseInt(String(input), 10);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "INVALID_SHOT_ID" };
  return { ok: true, value: n };
}

function simulateVideoUpdate(job: any, shots: any[]) {
  if (job.type !== "VIDEO_GEN") return { updated: false };
  if (!job.payload?.shotId || !job.projectId) return { updated: false };
  const shotId = Number(job.payload.shotId);
  const shot = shots.find(s => s.id === shotId && s.projectId === job.projectId);
  if (!shot) return { updated: false, warn: "shot not found or project mismatch" };
  shot.videoUrl = "/api/storage/supabase/videos/test.mp4";
  return { updated: true, shot };
}

test('KAYAN-13 Video Shot Link Tests', async (t) => {
  await t.test('A1: valid shotId', () => {
    const res = validateShotId(752);
    assert.equal(res.ok, true);
    assert.equal(res.value, 752);
  });
  await t.test('A2: invalid shotId (string)', () => {
    const res = validateShotId("abc");
    assert.equal(res.ok, false);
  });
  await t.test('A3: invalid shotId (negative)', () => {
    const res = validateShotId(-5);
    assert.equal(res.ok, false);
  });
  await t.test('A4: omitted shotId', () => {
    const res = validateShotId(undefined);
    assert.equal(res.ok, true);
    assert.equal(res.value, undefined);
  });

  const mockShots = [
    { id: 752, projectId: 651, videoUrl: null },
    { id: 753, projectId: 652, videoUrl: null },
  ];

  await t.test('B1: VIDEO_GEN success + matching shot', () => {
    const job = { type: "VIDEO_GEN", projectId: 651, payload: { shotId: 752 } };
    const res = simulateVideoUpdate(job, mockShots);
    assert.equal(res.updated, true);
    assert.match(res.shot.videoUrl, /supabase/);
  });
  await t.test('B2: VIDEO_GEN shot not found', () => {
    const job = { type: "VIDEO_GEN", projectId: 651, payload: { shotId: 9999 } };
    const res = simulateVideoUpdate(job, mockShots);
    assert.equal(res.updated, false);
    assert.match(res.warn, /shot not found/);
  });
  await t.test('B3: VIDEO_GEN wrong project', () => {
    const job = { type: "VIDEO_GEN", projectId: 999, payload: { shotId: 752 } };
    const res = simulateVideoUpdate(job, mockShots);
    assert.equal(res.updated, false);
    assert.match(res.warn, /shot not found/);
  });
  await t.test('B5: shotId not passed', () => {
    const job = { type: "VIDEO_GEN", projectId: 651, payload: {} };
    const res = simulateVideoUpdate(job, mockShots);
    assert.equal(res.updated, false);
  });
  await t.test('C1: idempotency (overwrite)', () => {
    const job = { type: "VIDEO_GEN", projectId: 651, payload: { shotId: 752 } };
    mockShots[0].videoUrl = "old_url";
    const res = simulateVideoUpdate(job, mockShots);
    assert.equal(res.updated, true);
    assert.notEqual(res.shot.videoUrl, "old_url");
  });
});
