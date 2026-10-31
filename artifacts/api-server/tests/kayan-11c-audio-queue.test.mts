import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// محاكاة منطق الفلترة والترتيب الموجود في الـ Endpoint
function simulateQueue(shots: any[], limit: number, lang: string) {
  let filtered = shots.filter(s => 
    s.audioStatus === 'QUEUED' && 
    s.dialogue && s.dialogue.trim() !== ''
  );

  const isArabic = (text: string) => /[\u0600-\u06FF]/.test(text);

  if (lang === 'ar') {
    filtered = filtered.filter(s => isArabic(s.dialogue));
  } else if (lang === 'en') {
    filtered = filtered.filter(s => !isArabic(s.dialogue));
  }

  filtered.sort((a, b) => {
    const aAr = isArabic(a.dialogue) ? 0 : 1;
    const bAr = isArabic(b.dialogue) ? 0 : 1;
    if (aAr !== bAr) return aAr - bAr;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return filtered.slice(0, Math.min(limit, 20));
}

test('KAYAN-11c Audio Queue Tests', async (t) => {
  const mockShots = [
    { id: 1, audioStatus: 'QUEUED', dialogue: 'Hello', createdAt: '2026-10-01T10:00:00Z' },
    { id: 2, audioStatus: 'COMPLETED', dialogue: 'مرحبا', createdAt: '2026-10-01T09:00:00Z' },
    { id: 3, audioStatus: 'QUEUED', dialogue: 'مرحبا', createdAt: '2026-10-01T11:00:00Z' },
    { id: 4, audioStatus: 'QUEUED', dialogue: '  ', createdAt: '2026-10-01T12:00:00Z' },
    { id: 5, audioStatus: 'PROCESSING', dialogue: 'مرحبا', createdAt: '2026-10-01T13:00:00Z' },
    { id: 6, audioStatus: 'QUEUED', dialogue: 'Test', createdAt: '2026-10-01T08:00:00Z' },
  ];

  await t.test('1. Returns only QUEUED with non-empty dialogue', () => {
    const res = simulateQueue(mockShots, 10, 'all');
    assert.equal(res.length, 3);
    assert.equal(res.some(s => s.id === 2), false);
    assert.equal(res.some(s => s.id === 4), false);
    assert.equal(res.some(s => s.id === 5), false);
  });

  await t.test('2. Arabic first, then English', () => {
    const res = simulateQueue(mockShots, 10, 'all');
    // Arabic (id 3) should be first, then English (id 6, then 1)
    assert.equal(res[0].id, 3);
    assert.equal(res[1].id, 6);
    assert.equal(res[2].id, 1);
  });

  await t.test('3. lang=ar filters only Arabic', () => {
    const res = simulateQueue(mockShots, 10, 'ar');
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 3);
  });

  await t.test('4. lang=en filters only English', () => {
    const res = simulateQueue(mockShots, 10, 'en');
    assert.equal(res.length, 2);
    assert.equal(res[0].id, 6);
    assert.equal(res[1].id, 1);
  });

  await t.test('5. limit caps correctly', () => {
    const res = simulateQueue(mockShots, 1, 'all');
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 3);
  });
});
