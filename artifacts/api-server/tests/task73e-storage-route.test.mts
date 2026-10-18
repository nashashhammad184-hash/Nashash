import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isSyntheticReference, assertSyntheticReference } from "../src/lib/legalGuard";
import { _resetStorageForTests, StorageError } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
function restoreEnv() {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]!;
  }
}

// ═══ legalGuard: R2 internal paths ═══
{
  report("TASK-73E-01 /api/storage/r2/audio/x.mp3 accepted",
    isSyntheticReference("/api/storage/r2/audio/x.mp3") === true);
  report("TASK-73E-02 /api/storage/r2/ empty key rejected",
    isSyntheticReference("/api/storage/r2/") === false);
  report("TASK-73E-03 /api/storage/r2/../etc rejected",
    isSyntheticReference("/api/storage/r2/../etc") === false);
  report("TASK-73E-04 /api/storage/r2/a/../b rejected",
    isSyntheticReference("/api/storage/r2/a/../b") === false);
  report("TASK-73E-05 backslash rejected",
    isSyntheticReference("/api/storage/r2/audio\\x.mp3") === false);
  report("TASK-73E-06 leading slash in key rejected",
    isSyntheticReference("/api/storage/r2//abs") === false);
}

// ═══ legalGuard: existing valid paths still work ═══
{
  report("TASK-73E-07 /uploads/ accepted",
    isSyntheticReference("/uploads/audio/x.mp3") === true);
  report("TASK-73E-08 data:image accepted",
    isSyntheticReference("data:image/png;base64,AAAA") === true);
  report("TASK-73E-09 javascript: rejected",
    isSyntheticReference("javascript:alert(1)") === false);
  report("TASK-73E-10 https:// rejected",
    isSyntheticReference("https://evil.com/x.jpg") === false);
  report("TASK-73E-11 assertSyntheticReference throws on invalid",
    (() => { try { assertSyntheticReference("https://x.com/y.jpg"); return false; } catch { return true; } })());
}

// ═══ Static: route registered ═══
{
  const idx = fs.readFileSync("./src/routes/index.ts", "utf-8");
  report("TASK-73E-12 storage router imported", /import storageRouter/.test(idx));
  report("TASK-73E-13 storage router mounted", /router\.use\(storageRouter\)/.test(idx));
}

// ═══ Static: route uses Express 5 wildcard syntax ═══
{
  const r = fs.readFileSync("./src/routes/storage.ts", "utf-8");
  report("TASK-73E-14 uses {*key} syntax", /\/storage\/r2\/\{\*key\}/.test(r));
  report("TASK-73E-15 no legacy :key(*) syntax", !/:key\(\*\)/.test(r));
}

// ═══ Static: route security ═══
{
  const r = fs.readFileSync("./src/routes/storage.ts", "utf-8");
  report("TASK-73E-16 uses assertSafeKey", /assertSafeKey/.test(r));
  report("TASK-73E-17 rejects non-r2 provider", /provider\.name !== "r2"/.test(r));
  report("TASK-73E-18 supports Range", /Range/.test(r) && /bytes=/.test(r));
  report("TASK-73E-19 sets Content-Type", /setHeader\("Content-Type"/.test(r));
  report("TASK-73E-20 sets Content-Length", /setHeader\("Content-Length"/.test(r));
  report("TASK-73E-21 no credentials in URLs/errors", !/R2_ACCESS_KEY|R2_SECRET/.test(r));
  report("TASK-73E-22 no fetch to external URLs", !/\bfetch\(/.test(r));
}

// ═══ Static: r2 publicUrl matches route ═══
{
  const r2p = fs.readFileSync("./src/lib/storage/r2Provider.ts", "utf-8");
  const rt = fs.readFileSync("./src/routes/storage.ts", "utf-8");
  report("TASK-73E-23 publicUrl returns /api/storage/r2/", /\/api\/storage\/r2\//.test(r2p));
  report("TASK-73E-24 route matches same prefix", /storage\/r2\//.test(rt));
}

restoreEnv();
_resetStorageForTests();

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
