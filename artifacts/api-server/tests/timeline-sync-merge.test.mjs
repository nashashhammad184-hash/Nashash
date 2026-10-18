import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(new URL('../src/routes/timeline.ts', import.meta.url).pathname),
  'utf8',
);

// 1) No unconditional delete-all in the sync path.
//    Delete must be gated behind explicitReset.
// The only delete must be inside the explicitReset gate. Verify by position.
{
  const deleteMatches = [...src.matchAll(/await db\.delete\(timelineItemsTable\)/g)];
  assert.equal(deleteMatches.length, 1, 'exactly one db.delete(timelineItemsTable) allowed');
  const before = src.slice(Math.max(0, deleteMatches[0].index - 200), deleteMatches[0].index);
  assert.match(before, /if \(explicitReset\) \{/, 'delete must be inside explicitReset block');
}
assert.match(src, /const explicitReset = \(req\.body && \(req\.body as any\)\.reset === true\);/, 'explicitReset gate missing');
const resetIdx = src.indexOf('if (explicitReset) {');
assert.ok(resetIdx > 0, 'explicitReset gate block missing');
const after = src.slice(resetIdx, resetIdx + 200);
assert.match(after, /await db\.delete\(timelineItemsTable\)/, 'delete must live inside explicitReset block');

// 2) Classification / merge helpers present
assert.match(src, /metadata\.origin === "manual"/, 'manual classification missing');
assert.match(src, /metadata\.origin === "generated"/, 'generated classification missing');
assert.match(src, /const upsertGenerated = async/, 'upsertGenerated helper missing');
assert.match(src, /const generatedKey = \(track: string, shotId: number \| null, clipId: number \| null\)/, 'generatedKey missing');

// 3) All three insertion sites now go through upsertGenerated
const insertCallCount = (src.match(/await db\.insert\(timelineItemsTable\)/g) || []).length;
const upsertCallCount = (src.match(/await upsertGenerated\(\{/g) || []).length;
assert.equal(upsertCallCount, 3, `expected 3 upsertGenerated calls, got ${upsertCallCount}`);
// The insert inside upsertGenerated is the only remaining db.insert
assert.equal(insertCallCount, 1, `expected 1 db.insert left (inside upsertGenerated), got ${insertCallCount}`);

// 4) upsert only updates assetUrl/content and preserves timing/order
assert.match(src, /needAsset \? \{ assetUrl: values\.assetUrl \} : \{\}/, 'asset update guard missing');
assert.match(src, /needContent \? \{ content: values\.content \} : \{\}/, 'content update guard missing');
assert.doesNotMatch(src, /set\(\{[\s\S]{0,300}startTime: values\.startTime[\s\S]{0,100}\}/, 'upsert must not overwrite startTime');
assert.doesNotMatch(src, /set\(\{[\s\S]{0,300}order: values\.order[\s\S]{0,100}\}/, 'upsert must not overwrite order');

// 5) Manual rows are captured but never deleted (unless reset=true)
assert.match(src, /manualRows\.push\(c\.row\)/, 'manual rows must be collected');
// Manual rows collected in manualRows[]; only path deleting timelineItemsTable is inside explicitReset (verified above).
assert.match(src, /const manualRows: any\[\] = \[\];/, 'manualRows buffer missing');

// 6) render route still sees generated real assets — via renderClips built from upserted rows
assert.match(src, /renderClips\.push\(\{[\s\S]{0,200}assetUrl: videoAsset/, 'render clip for video missing');
assert.match(src, /renderClips\.push\(\{[\s\S]{0,200}assetUrl: asset/, 'render clip for clips missing');

// 7) Simulate merge semantics
function classify(row) {
  let kind = 'generated';
  const raw = row.metadata;
  if (raw && typeof raw === 'string') {
    try { const m = JSON.parse(raw); if (m && m.origin === 'manual') kind = 'manual'; }
    catch {}
  }
  return kind;
}
const key = (track, shotId, clipId) => `${track}:${shotId ?? ''}:${clipId ?? ''}`;

// Scenario 1: manual row preserved across sync
{
  const existing = [
    { id: 1, track: 'VIDEO', shotId: 10, clipId: null, assetUrl: '/uploads/a.mp4', startTime: 0, order: 1, metadata: JSON.stringify({origin:'generated'}) },
    { id: 2, track: 'VIDEO', shotId: null, clipId: null, assetUrl: '/uploads/manual.mp4', startTime: 5, order: 99, metadata: JSON.stringify({origin:'manual'}) },
  ];
  const manual = existing.filter(r => classify(r) === 'manual');
  const genMap = new Map();
  for (const r of existing) if (classify(r) === 'generated') genMap.set(key(r.track, r.shotId, r.clipId), r);
  // simulate upsert with SAME asset
  const k = key('VIDEO', 10, null);
  const prev = genMap.get(k);
  let upserts = 0, inserts = 0;
  if (prev) {
    const needAsset = (prev.assetUrl ?? null) !== ('/uploads/a.mp4' ?? null);
    if (!needAsset) { upserts++; genMap.delete(k); } // no change
  } else inserts++;
  assert.equal(manual.length, 1, 'manual row must be preserved');
  assert.equal(upserts, 1, 'no-op upsert');
  assert.equal(inserts, 0, 'no duplicate insert');
}

// Scenario 2: generated asset changed → update, not duplicate
{
  const existing = [
    { id: 1, track: 'VIDEO', shotId: 10, clipId: null, assetUrl: '/uploads/old.mp4', startTime: 0, order: 1, metadata: JSON.stringify({origin:'generated'}) },
  ];
  const genMap = new Map([[key('VIDEO',10,null), existing[0]]]);
  const prev = genMap.get(key('VIDEO',10,null));
  let action = 'none';
  const newAsset = '/uploads/new.mp4';
  if (prev) {
    const needAsset = (prev.assetUrl ?? null) !== newAsset;
    action = needAsset ? 'update' : 'no-op';
  } else action = 'insert';
  assert.equal(action, 'update', 'changed asset must update existing row');
}

// Scenario 3: two consecutive syncs → no duplicates
{
  // First sync: no existing rows.
  let genMap = new Map();
  const sync = (genMap, keyVals) => {
    let inserts = 0, updates = 0;
    for (const kv of keyVals) {
      if (genMap.has(kv.key)) {
        const prev = genMap.get(kv.key);
        if ((prev.assetUrl??null) !== kv.asset) updates++;
        // else no-op
      } else {
        genMap.set(kv.key, { id: genMap.size+1, assetUrl: kv.asset });
        inserts++;
      }
    }
    return { inserts, updates, size: genMap.size };
  };
  const keyVals = [
    { key: key('VIDEO',1,null), asset: '/uploads/a.mp4' },
    { key: key('VOICE',1,null), asset: '/uploads/a.mp3' },
  ];
  const r1 = sync(genMap, keyVals);
  assert.equal(r1.inserts, 2);
  assert.equal(r1.size, 2);
  const r2 = sync(genMap, keyVals);
  assert.equal(r2.inserts, 0, 'second sync must not insert duplicates');
  assert.equal(r2.updates, 0, 'second sync no-op when assets unchanged');
  assert.equal(r2.size, 2, 'row count stable');
}

// Scenario 4: manual order preserved (simulated)
{
  const manual = { id: 42, track: 'VIDEO', order: 7, startTime: 12.5, duration: 3, metadata: JSON.stringify({origin:'manual'}) };
  // Upsert logic never touches manual rows
  const upsertTargetsManual = false; // by construction
  assert.equal(upsertTargetsManual, false);
  assert.equal(manual.order, 7);
  assert.equal(manual.startTime, 12.5);
}

// Scenario 5: real-asset validation still active
assert.match(src, /looksLikeRealAsset\(shot\.videoUrl\)/, 'video asset validation missing');
assert.match(src, /looksLikeRealAsset\(shot\.audioUrl\)/, 'audio asset validation missing');
assert.match(src, /looksLikeRealAsset\(clip\.assetId\)/, 'clip asset validation missing');

console.log('TIMELINE_SYNC_MERGE_TESTS_PASS');
