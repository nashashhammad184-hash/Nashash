import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = fs.readFileSync(path.join(root, 'src/lib/securityMiddleware.ts'), 'utf8');

// 1) No unconditional next() when token missing
assert.doesNotMatch(
  src,
  /if \(!expectedToken\)\s*\{\s*next\(\);\s*return;\s*\}/,
  'old pass-through on missing token still present'
);

// 2) Fail-closed for production
assert.match(src, /PRODUCTION_AUTH_NOT_CONFIGURED/, 'fail-closed 503 missing');
assert.match(src, /res\.status\(503\)/, '503 status missing');

// 3) Dev bypass must be explicit AND require ALLOW_DEV_PRODUCTION_BYPASS
assert.match(src, /NODE_ENV/, 'NODE_ENV check missing');
assert.match(src, /ALLOW_DEV_PRODUCTION_BYPASS/, 'dev bypass flag missing');
assert.match(src, /isDev && devBypass/, 'both conditions required for bypass');

// 4) Token never logged
assert.doesNotMatch(src, /console\.log\([^)]*expectedToken/, 'must not log expected token');
assert.doesNotMatch(src, /console\.log\([^)]*provided/, 'must not log provided token');
assert.doesNotMatch(src, /logger\.[a-z]+\([^)]*expectedToken/, 'must not log via logger');

// 5) Bearer 401 paths preserved
assert.match(src, /Unauthorized: Bearer token required/, 'bearer required msg missing');
assert.match(src, /Unauthorized: invalid production token/, 'invalid token msg missing');

// 6) All dangerous endpoints wired
const routeDir = path.join(root, 'src/routes');
const dangerous = {
  'video.ts':        /router\.post\("\/generate",\s*generateLimiter,\s*requireProductionAuth/,
  'render.ts':       /router\.post\("\/projects\/:id\/render\/start",\s*requireProductionAuth/,
  'scripts.ts':      /router\.post\("\/scripts\/generate",\s*requireProductionAuth/,
  'pipeline.ts':     /router\.post\(\["\/",\s*"\/start",\s*"\/run"\],\s*requireProductionAuth/,
  'production.ts':   /router\.post\("\/production\/jobs",\s*requireProductionAuth/,
  'audio.ts':        /router\.post\("\/audio\/generate",\s*requireProductionAuth/,
  'lipsync.ts':      /router\.post\("\/",\s*requireProductionAuth/,
  'timeline.ts':     /router\.post\("\/projects\/:id\/timeline\/sync",\s*requireProductionAuth/,
  'subtitles.ts':    /router\.post\("\/projects\/:id\/subtitles\/sync",\s*requireProductionAuth/,
  'voice.ts':        /requireProductionAuth,/,
};
for (const [file, re] of Object.entries(dangerous)) {
  const s = fs.readFileSync(path.join(routeDir, file), 'utf8');
  assert.match(s, re, `${file} missing requireProductionAuth`);
  assert.match(s, /requireProductionAuth/, `${file} missing import/use`);
}

// 7) Frontend must not leak token
const studioDir = path.resolve(root, '../studio/src');
function walk(d, out=[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(studioDir);
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(s, /PRODUCTION_API_TOKEN/, `frontend leaks token env: ${f}`);
  assert.doesNotMatch(s, /ALLOW_DEV_PRODUCTION_BYPASS/, `frontend leaks bypass flag: ${f}`);
}

// 8) Simulate policy matrix
function simulate({ token, nodeEnv, allowDevBypass, authHeader }) {
  if (!token) {
    const isDev = (nodeEnv || '').toLowerCase() === 'development';
    const devBypass = (allowDevBypass || '').toLowerCase() === 'true';
    if (isDev && devBypass) return 200;
    return 503;
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) return 401;
  const provided = authHeader.slice('Bearer '.length).trim();
  return provided === token ? 200 : 401;
}
// Production + no token → reject
assert.equal(simulate({ token: '', nodeEnv: 'production' }), 503);
// Production + wrong token → 401
assert.equal(simulate({ token: 'X', nodeEnv: 'production', authHeader: 'Bearer wrong' }), 401);
// Production + correct token → pass
assert.equal(simulate({ token: 'X', nodeEnv: 'production', authHeader: 'Bearer X' }), 200);
// Development + explicit bypass → pass
assert.equal(simulate({ token: '', nodeEnv: 'development', allowDevBypass: 'true' }), 200);
// Development WITHOUT explicit bypass → reject
assert.equal(simulate({ token: '', nodeEnv: 'development' }), 503);
// Development + wrong bypass value → reject
assert.equal(simulate({ token: '', nodeEnv: 'development', allowDevBypass: 'false' }), 503);

console.log('PRODUCTION_AUTH_TESTS_PASS');
