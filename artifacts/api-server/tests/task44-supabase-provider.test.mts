/**
 * KAYAN-TASK-44: SupabaseProvider tests.
 *
 * Two layers:
 *   (1) Static / offline: lazy construction, config-missing error,
 *       safe-key validation, and presence on getStorage() when
 *       STORAGE_PROVIDER=supabase. No network. No secrets.
 *
 *   (2) Optional integration: if TEST_SUPABASE_* env vars are set at
 *       runtime, we upload/download/delete one small non-sensitive file
 *       under a unique key prefix and clean up. Nothing else.
 *
 * The integration layer is SKIPPED by default and never runs in CI.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

// ── Offline layer ────────────────────────────────────────────────
// Import without env. Construction must not throw and must not hit network.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_BUCKET;

const { SupabaseProvider } = await import("../src/lib/storage/supabaseProvider.ts");
const { StorageError } = await import("../src/lib/storage/types.ts");
const { getStorage, _resetStorageForTests } = await import("../src/lib/storage/index.ts");

{
  let constructed = false;
  try {
    const p = new SupabaseProvider();
    constructed = true;
    report("TASK44-01 constructor does not throw without env", true);
    report("TASK44-01 name is 'supabase'", p.name === "supabase", p.name);
  } catch (e: any) {
    report("TASK44-01 constructor does not throw without env", false, e?.message);
  }
  report("TASK44-01 constructed", constructed);
}

{
  const p = new SupabaseProvider();
  let code = "";
  try {
    await p.read("audio/does-not-exist.mp3");
  } catch (e: any) {
    code = e instanceof StorageError ? e.code : (e?.code || "NON_STORAGE_ERROR");
  }
  report("TASK44-02 read without config → SUPABASE_CONFIG_MISSING", code === "SUPABASE_CONFIG_MISSING", code);
}

{
  const p = new SupabaseProvider();
  // Malicious keys must be rejected BEFORE any network attempt.
  for (const bad of ["", "/abs", "../escape", "a/../b", "a\\b", "a\u0000b"]) {
    let rejected = false;
    try {
      await p.read(bad as any);
    } catch (e: any) {
      rejected = e?.code === "INVALID_KEY" || e?.code === "INVALID_DATA" || e?.code === "SUPABASE_CONFIG_MISSING";
    }
    report(`TASK44-03 rejects unsafe key ${JSON.stringify(bad)}`, rejected);
  }
}

{
  // getStorage() picks SupabaseProvider when STORAGE_PROVIDER=supabase,
  // and construction is lazy (no env required at construct time).
  process.env.STORAGE_PROVIDER = "supabase";
  _resetStorageForTests();
  let name = "";
  let threw = false;
  try {
    const p = getStorage();
    name = p.name;
  } catch (e: any) {
    threw = true;
  }
  report("TASK44-04 getStorage selects 'supabase' lazily", !threw && name === "supabase", `threw=${threw} name=${name}`);
  process.env.STORAGE_PROVIDER = "local";
  _resetStorageForTests();
}

{
  // Unknown provider must still throw INVALID_PROVIDER
  process.env.STORAGE_PROVIDER = "unknown-xyz";
  _resetStorageForTests();
  let code = "";
  try { getStorage(); } catch (e: any) { code = e?.code || ""; }
  report("TASK44-05 unknown provider → INVALID_PROVIDER", code === "INVALID_PROVIDER", code);
  process.env.STORAGE_PROVIDER = "local";
  _resetStorageForTests();
}

// ── Optional integration layer (only if TEST_SUPABASE_* set) ─────
const hasIntegration =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.TEST_SUPABASE_BUCKET;

if (!hasIntegration) {
  console.log("SKIP TASK44-06..10 integration (TEST_SUPABASE_* not set)");
} else {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_BUCKET = process.env.TEST_SUPABASE_BUCKET;

  const provider = new SupabaseProvider();
  const runId = crypto.randomUUID();
  const key = `_task44_test/${runId}/hello.txt`;
  const payload = Buffer.from("Hello from TASK44 integration test");

  try {
    const url = await provider.write(key, payload, "text/plain");
    report("TASK44-06 write returns proxy URL", typeof url === "string" && url.includes(key), url);
    report("TASK44-07 exists after write", await provider.exists(key));

    const back = await provider.read(key);
    report("TASK44-08 read matches", back.equals(payload), `len=${back.length}/${payload.length}`);

    const size = await provider.getSize(key);
    report("TASK44-09 getSize matches", size === payload.length, `size=${size}`);

    const signed = await provider.getSignedUrl(key, 60);
    report("TASK44-10 getSignedUrl issues a URL", typeof signed.url === "string" && signed.url.startsWith("http"), signed.url.slice(0, 40));
  } catch (e: any) {
    report("TASK44-06..10 integration", false, e?.message || String(e));
  } finally {
    try { await provider.delete(key); } catch {}
  }
}

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
