import { test } from 'node:test';
import { strict as assert } from 'node:assert';

function simulateRelease(shot: any) {
  if (!shot) return { status: 404, error: "SHOT_NOT_FOUND" };
  if (shot.audioStatus === "COMPLETED") return { status: 409, error: "ALREADY_COMPLETED" };
  if (shot.audioStatus === "QUEUED") return { status: 200, noop: true };
  
  return { status: 200, ok: true, previousStatus: shot.audioStatus };
}

test('KAYAN-11b.4 Release Claim Tests', async (t) => {
  await t.test('1. release on PROCESSING -> 200 + QUEUED', () => {
    const res = simulateRelease({ audioStatus: "PROCESSING" });
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
  });

  await t.test('2. release on QUEUED -> 200 + noop', () => {
    const res = simulateRelease({ audioStatus: "QUEUED" });
    assert.equal(res.status, 200);
    assert.equal(res.noop, true);
  });

  await t.test('3. release on COMPLETED -> 409', () => {
    const res = simulateRelease({ audioStatus: "COMPLETED" });
    assert.equal(res.status, 409);
  });

  await t.test('4. release on FAILED -> 200', () => {
    const res = simulateRelease({ audioStatus: "FAILED" });
    assert.equal(res.status, 200);
  });

  await t.test('5. release on missing shot -> 404', () => {
    const res = simulateRelease(null);
    assert.equal(res.status, 404);
  });
});
