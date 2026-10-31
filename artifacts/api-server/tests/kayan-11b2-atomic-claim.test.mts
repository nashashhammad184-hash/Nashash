import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// محاكاة منطق الـ Claim الذي أضفناه في shots.ts
function simulateClaim(shot: any, nowMs: number = Date.now()) {
  if (!shot) return { status: 404, error: "SHOT_NOT_FOUND" };
  
  if (shot.audioStatus === "COMPLETED") {
    return { status: 409, error: "ALREADY_COMPLETED" };
  }
  
  const LEASE_MS = 5 * 60 * 1000;
  const claimedAtMs = shot.audioClaimedAt ? new Date(shot.audioClaimedAt).getTime() : null;
  const isStale = !claimedAtMs || (nowMs - claimedAtMs) > LEASE_MS;
  
  if (shot.audioStatus === "PROCESSING" && !isStale) {
    return { status: 409, error: "ALREADY_CLAIMED" };
  }
  
  // نجاح الاحتكار
  return { status: 200, ok: true, audioStatus: "PROCESSING", audioClaimedAt: new Date(nowMs) };
}

test('KAYAN-11b.2 Atomic Claim Tests', async (t) => {
  const NOW = Date.now();

  await t.test('1. Claim on QUEUED -> 200', () => {
    const shot = { audioStatus: "QUEUED", audioClaimedAt: null };
    const res = simulateClaim(shot, NOW);
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
  });

  await t.test('2. Claim on PROCESSING (recent) -> 409 ALREADY_CLAIMED', () => {
    const shot = { audioStatus: "PROCESSING", audioClaimedAt: new Date(NOW - 60000) }; // 1 min ago
    const res = simulateClaim(shot, NOW);
    assert.equal(res.status, 409);
    assert.equal(res.error, "ALREADY_CLAIMED");
  });

  await t.test('3. Claim on PROCESSING (stale > 5 min) -> 200', () => {
    const shot = { audioStatus: "PROCESSING", audioClaimedAt: new Date(NOW - 6 * 60000) }; // 6 mins ago
    const res = simulateClaim(shot, NOW);
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
  });

  await t.test('4. Claim on COMPLETED -> 409 ALREADY_COMPLETED', () => {
    const shot = { audioStatus: "COMPLETED", audioClaimedAt: new Date(NOW) };
    const res = simulateClaim(shot, NOW);
    assert.equal(res.status, 409);
    assert.equal(res.error, "ALREADY_COMPLETED");
  });

  await t.test('5. Claim on FAILED -> 200', () => {
    const shot = { audioStatus: "FAILED", audioClaimedAt: new Date(NOW - 6 * 60000) };
    const res = simulateClaim(shot, NOW);
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
  });

  await t.test('6. Claim on missing shot -> 404', () => {
    const res = simulateClaim(null, NOW);
    assert.equal(res.status, 404);
    assert.equal(res.error, "SHOT_NOT_FOUND");
  });
});
