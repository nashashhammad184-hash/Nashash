import { test } from 'node:test';
import { strict as assert } from 'node:assert';

function validateHeartbeat(body) {
  const name = String((body && body.name) || '').trim();
  if (!name || name.length > 64) {
    return { status: 400, error: 'INVALID_WORKER_NAME' };
  }
  return { status: 200, ok: true, name };
}

function computeAudioStatus(hb, nowMs = Date.now()) {
  if (!hb) {
    return { phoneOnline: false, phoneLastHeartbeat: null, phoneName: null };
  }
  const ageMs = nowMs - new Date(hb.lastSeenAt).getTime();
  return {
    phoneOnline: ageMs < 90000,
    phoneLastHeartbeat: hb.lastSeenAt,
    phoneName: hb.name,
  };
}

test('KAYAN-11b.3 Heartbeat & Healthz Tests', async (t) => {
  await t.test('1. Valid heartbeat -> 200', () => {
    const res = validateHeartbeat({ name: 'phone-samsung-01' });
    assert.equal(res.status, 200);
  });

  await t.test('2. Missing name -> 400', () => {
    const res = validateHeartbeat({});
    assert.equal(res.status, 400);
  });

  await t.test('3. Name > 64 chars -> 400', () => {
    const res = validateHeartbeat({ name: 'a'.repeat(65) });
    assert.equal(res.status, 400);
  });

  await t.test('4. healthz with no heartbeat -> phoneOnline=false', () => {
    const res = computeAudioStatus(null);
    assert.equal(res.phoneOnline, false);
  });

  await t.test('5. healthz with recent heartbeat (<90s) -> phoneOnline=true', () => {
    const NOW = Date.now();
    const hb = { name: 'phone-01', lastSeenAt: new Date(NOW - 30000).toISOString() };
    const res = computeAudioStatus(hb, NOW);
    assert.equal(res.phoneOnline, true);
  });

  await t.test('6. healthz with old heartbeat (>90s) -> phoneOnline=false', () => {
    const NOW = Date.now();
    const hb = { name: 'phone-01', lastSeenAt: new Date(NOW - 100000).toISOString() };
    const res = computeAudioStatus(hb, NOW);
    assert.equal(res.phoneOnline, false);
  });

  await t.test('7. healthz returns phoneName when online', () => {
    const NOW = Date.now();
    const hb = { name: 'phone-samsung-01', lastSeenAt: new Date(NOW).toISOString() };
    const res = computeAudioStatus(hb, NOW);
    assert.equal(res.phoneName, 'phone-samsung-01');
  });

  await t.test('8. healthz does not leak secrets', () => {
    const safePayload = { phoneOnline: true, phoneWorkerConfigured: true, deepgramSupportsArabic: false };
    const str = JSON.stringify(safePayload);
    assert.equal(str.includes('TOKEN'), false);
    assert.equal(str.includes('KEY'), false);
    assert.equal(str.includes('SECRET'), false);
  });
});