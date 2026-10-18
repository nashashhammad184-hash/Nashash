import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateCanonicalFaceQuality } from '../src/lib/canonicalFaceQuality.ts';

const TMP = fs.mkdtempSync('/tmp/cfq-');
const ff = (args) => execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error', ...args]);
const p = (n) => path.join(TMP, n);

ff(['-f','lavfi','-i','testsrc2=size=512x512:rate=1:duration=1','-q:v','2','-frames:v','1', p('pass.jpg')]);
ff(['-f','lavfi','-i','testsrc2=size=64x64:rate=1:duration=1','-frames:v','1', p('small.jpg')]);
ff(['-f','lavfi','-i','color=c=gray:s=512x512:d=1','-q:v','1','-frames:v','1', p('flat.jpg')]);
ff(['-f','lavfi','-i','nullsrc=size=512x512,geq=random(1)*20:128:128','-q:v','1','-frames:v','1', p('dark.jpg')]);
fs.writeFileSync(p('corrupt.jpg'), Buffer.from([0xFF,0xD8,0xFF,0x00,0x01,0x02,0x03]));

const rPass    = await validateCanonicalFaceQuality(p('pass.jpg'));
const rSmall   = await validateCanonicalFaceQuality(p('small.jpg'));
const rFlat    = await validateCanonicalFaceQuality(p('flat.jpg'));
const rDark    = await validateCanonicalFaceQuality(p('dark.jpg'));
const rCorrupt = await validateCanonicalFaceQuality(p('corrupt.jpg'));
const rMissing = await validateCanonicalFaceQuality('/nonexistent/x.jpg');

console.log('pass:',    rPass.pass,    rPass.reasons,    rPass.metrics);
console.log('small:',   rSmall.pass,   rSmall.reasons);
console.log('flat:',    rFlat.pass,    rFlat.reasons);
console.log('dark:',    rDark.pass,    rDark.reasons);
console.log('corrupt:', rCorrupt.pass, rCorrupt.reasons);
console.log('missing:', rMissing.pass, rMissing.reasons);

assert.equal(rMissing.pass, false); assert.ok(rMissing.reasons.includes('file_missing'));
assert.equal(rCorrupt.pass, false);
assert.equal(rSmall.pass, false); assert.ok(rSmall.reasons.some(r=>r.startsWith('dimensions_too_small')));
assert.equal(rFlat.pass, false);  assert.ok(rFlat.reasons.some(r=>r.startsWith('too_flat')||r.startsWith('low_contrast')), 'flat: '+rFlat.reasons.join(','));
assert.equal(rDark.pass, false);  assert.ok(rDark.reasons.some(r=>r.startsWith('too_dark')), 'dark: '+rDark.reasons.join(','));
assert.equal(rPass.pass, true, 'pass fixture should pass: '+rPass.reasons.join(','));

const face = fs.readFileSync(path.resolve(new URL('../src/lib/faceIdentity.ts', import.meta.url).pathname),'utf8');
const qIdx = face.indexOf('validateCanonicalFaceQuality(abs)');
const dbIdx = face.indexOf('.update(actorsTable)', qIdx);
assert.ok(qIdx > 0); assert.ok(dbIdx > qIdx);
assert.match(face, /CANONICAL_FACE_QUALITY_REJECTED/);
assert.match(face, /fs\.unlinkSync\(abs\)/);

console.log('CANONICAL_FACE_QUALITY_TESTS_PASS');
