import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const legal = fs.readFileSync(path.join(root, 'src/lib/legalGuard.ts'), 'utf8');
const actors = fs.readFileSync(path.join(root, 'src/routes/actors.ts'), 'utf8');

// legalGuard must NOT honor syntheticAcknowledged
assert.doesNotMatch(legal, /syntheticAcknowledged\s*===\s*true.*return\s+true/, 'legacy boolean bypass still present');
assert.doesNotMatch(legal, /body\.syntheticAcknowledged/, 'body.syntheticAcknowledged still read');
assert.match(legal, /data:image\//, 'data:image still accepted');
assert.match(legal, /uploads\//, 'uploads/ still accepted');
assert.match(legal, /storage_vault\//, 'storage_vault still accepted');

// references route guarded before insert
const refIdx = actors.indexOf('router.post("/actors/:actorId/references"');
const guardIdx = actors.indexOf('assertSyntheticReference(sanitizedUrl', refIdx);
const insertIdx = actors.indexOf('.insert(characterReferencesTable)', refIdx);
assert.ok(refIdx > 0, 'references route missing');
assert.ok(guardIdx > refIdx, 'legal guard not called in references');
assert.ok(insertIdx > guardIdx, 'guard must run BEFORE insert');

// canonical-face protected by auth + rate limiter
const cfIdx = actors.indexOf('"/actors/:actorId/canonical-face"');
const cfBlock = actors.slice(cfIdx, cfIdx + 400);
assert.match(cfBlock, /canonicalFaceLimiter/, 'rate limiter missing on canonical-face');
assert.match(cfBlock, /requireProductionAuth/, 'requireProductionAuth missing on canonical-face');

console.log('LEGAL_GATE_TESTS_PASS');
