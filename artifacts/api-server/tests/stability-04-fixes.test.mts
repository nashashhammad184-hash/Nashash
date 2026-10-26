/**
 * KAYAN-STABILITY-04: regression for lock TTL alignment + error sanitization.
 * Static analysis only — no DB, no network.
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── Test 1: STALE_MS >= 3 * HEARTBEAT_MS ─────────────────────────────
{
  const gpu = fs.readFileSync(path.resolve(process.cwd(), "src/lib/services/GpuQueueService.ts"), "utf8");
  const qw = fs.readFileSync(path.resolve(process.cwd(), "src/queue-worker.ts"), "utf8");

  const staleMatch = gpu.match(/const STALE_MS = ([0-9_*\s]+);/);
  const hbMatch = qw.match(/const HEARTBEAT_MS = ([0-9_]+);/);

  report("T1-a STALE_MS found", !!staleMatch, staleMatch?.[0] || "not found");
  report("T1-b HEARTBEAT_MS found", !!hbMatch, hbMatch?.[0] || "not found");

  if (staleMatch && hbMatch) {
    const staleMs = eval(staleMatch[1].replace(/_/g, ""));
    const hbMs = parseInt(hbMatch[1].replace(/_/g, ""), 10);
    report("T1-c STALE_MS >= 3 * HEARTBEAT_MS", staleMs >= 3 * hbMs, `stale=${staleMs} hb=${hbMs} ratio=${staleMs / hbMs}x`);
  }
}

// ─── Test 2: no err.message in res.status(500) responses ──────────────
{
  const files = ["timeline.ts", "clips.ts", "shots.ts"];
  for (const f of files) {
    const s = fs.readFileSync(path.resolve(process.cwd(), "src/routes/" + f), "utf8");
    const leaks = s.match(/res\.status\(500\)\.json\(\{[^}]*err\.message[^}]*\}/g) || [];
    const leaksErr = s.match(/res\.status\(500\)\.json\(\{[^}]*error\.message[^}]*\}/g) || [];
    report(`T2-${f} no err.message in 500 response`, leaks.length === 0 && leaksErr.length === 0, `err.message=${leaks.length} error.message=${leaksErr.length}`);
  }
}

// ─── Test 3: 500 responses use generic error codes ────────────────────
{
  const files = ["timeline.ts", "clips.ts", "shots.ts"];
  for (const f of files) {
    const s = fs.readFileSync(path.resolve(process.cwd(), "src/routes/" + f), "utf8");
    const generic = (s.match(/INTERNAL_ERROR/g) || []).length;
    const status500 = (s.match(/res\.status\(500\)/g) || []).length;
    report(`T3-${f} all 500s use INTERNAL_ERROR`, generic >= status500, `generic=${generic} 500s=${status500}`);
  }
}

// ─── Test 4: signed URL TTL >= 900s ───────────────────────────────────
{
  const s = fs.readFileSync(path.resolve(process.cwd(), "src/routes/storage.ts"), "utf8");
  const m = s.match(/SUPABASE_SIGNED_URL_TTL_SEC = ([0-9]+)/);
  report("T4-a TTL constant found", !!m);
  if (m) {
    const ttl = parseInt(m[1], 10);
    report("T4-b TTL >= 900s (15min)", ttl >= 900, `ttl=${ttl}s`);
    report("T4-c TTL <= 3600s (Supabase max)", ttl <= 3600, `ttl=${ttl}s`);
  }
}

// ─── Test 5: rate limit on /api/render/merge ──────────────────────────
{
  const s = fs.readFileSync(path.resolve(process.cwd(), "src/routes/renderMerge.ts"), "utf8");
  report("T5-a mergeLimiter defined", /const mergeLimiter = rateLimit/.test(s));
  report("T5-b limiter applied to POST /", /router\.post\(\"\/\",\s*mergeLimiter,\s*requireProductionAuth/.test(s));
  report("T5-c limit config present", /limit:\s*5/.test(s));
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
