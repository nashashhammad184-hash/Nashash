import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);

// 1) Official production code must not reference the legacy root src/
const officialSrcDir = path.join(root, 'artifacts/api-server/src');
function walk(d, out=[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const officialFiles = walk(officialSrcDir);
const badImports = [];
for (const f of officialFiles) {
  const s = fs.readFileSync(f, 'utf8');
  // Look for imports pointing at /src/services, /src/workers, or root server.js
  if (/from\s+['"][^'"]*\/src\/services\//.test(s)) badImports.push([f, 'src/services']);
  if (/from\s+['"][^'"]*\/src\/workers\//.test(s)) badImports.push([f, 'src/workers']);
  if (/require\(['"][^'"]*\/src\/services\//.test(s)) badImports.push([f, 'require src/services']);
  if (/from\s+['"][^'"]*\/src\/server\.js/.test(s)) badImports.push([f, 'src/server.js']);
  // Replicate must NOT appear as actual usage in official code (comments/strings OK if they say "no Replicate"/"removed")
  const lower = s.toLowerCase();
  if (/\breplicate\b/.test(lower)) {
    // Only flag if it looks like actual code usage, not a comment/string note
    // We flag any `replicate.run`, `Replicate(`, `from "replicate"` etc.
    if (/from\s+['"]replicate['"]/.test(s)) badImports.push([f, 'import replicate']);
    if (/replicate\.run\(/.test(lower)) badImports.push([f, 'replicate.run()']);
    if (new RegExp('new\\s+Replicate\\(').test(s)) badImports.push([f, 'new Replicate(']);
  }
}
assert.equal(badImports.length, 0, 'official code references legacy/replicate: ' + JSON.stringify(badImports));

// 2) package.json scripts must not use a name that looks production for legacy
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
assert.ok(!('inject:legacy' in scripts), 'inject:legacy must be renamed');
assert.ok('inject:LEGACY-DO-NOT-RUN-IN-PROD' in scripts, 'legacy script must be explicitly marked');
for (const [name, val] of Object.entries(scripts)) {
  if (/scripts\/legacy|src\/services|src\/workers/.test(val)) {
    assert.ok(/LEGACY-DO-NOT-RUN-IN-PROD/i.test(name), `script "${name}" runs legacy path without explicit marker`);
  }
}

// 3) README protection exists
assert.ok(fs.existsSync(path.join(root, 'src/README.md')), 'src/README.md missing');
assert.ok(fs.existsSync(path.join(root, 'scripts/legacy/README.md')), 'scripts/legacy/README.md missing');
const srcReadme = fs.readFileSync(path.join(root, 'src/README.md'), 'utf8');
assert.match(srcReadme, /LEGACY|UNTRUSTED|Do NOT import/, 'src/README must warn');
const legacyReadme = fs.readFileSync(path.join(root, 'scripts/legacy/README.md'), 'utf8');
assert.match(legacyReadme, /UNTRUSTED/, 'legacy README must warn');

// 4) video.test.ts is a legacy test with explicit banner
const vt = fs.readFileSync(path.join(officialSrcDir, 'routes/video.test.ts'), 'utf8');
assert.match(vt, /LEGACY TEST FILE|NOT EXECUTED IN PRODUCTION/, 'video.test.ts must be marked legacy');

// 5) Official production routes exist
const requiredOfficial = [
  'routes/pipeline.ts',
  'lib/productionEngine.ts',
  'lib/kayanGpuProvider.ts',
  'lib/renderEngine.ts',
  'routes/voice.ts',
  'queue-worker.ts',
];
for (const r of requiredOfficial) {
  assert.ok(fs.existsSync(path.join(officialSrcDir, r)), `official module missing: ${r}`);
}

// 6) No pnpm workspace includes root src/ (avoid accidental packaging)
const ws = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
assert.doesNotMatch(ws, /^\s*-\s*src\s*$/m, 'workspace must not include root src/');

console.log('LEGACY_ISOLATION_TESTS_PASS');
