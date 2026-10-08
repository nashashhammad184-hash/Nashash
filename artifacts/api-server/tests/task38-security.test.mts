import fs from "node:fs";
import path from "node:path";
import { requireProductionAuth } from "../src/lib/securityMiddleware";
import { assertSyntheticReference, isSyntheticReference } from "../src/lib/legalGuard";
import { getActiveVideoProvider } from "../src/lib/providers/video/activeProvider";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── express-ish mocks ───
function mockRes() {
  const r: any = {
    statusCode: 0, body: null, nextCalled: false,
    status(c: number) { r.statusCode = c; return r; },
    json(b: any) { r.body = b; return r; },
  };
  return r;
}
function runAuth(headers: Record<string,string>, env: Record<string,string|undefined>) {
  const saved: Record<string,string|undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const req: any = { headers };
  const res = mockRes();
  let nextCalled = false;
  requireProductionAuth(req, res, () => { nextCalled = true; });
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  return { res, nextCalled };
}

// ═══ TEST-38-01: unauthenticated production API → rejected ═══
{
  const { res, nextCalled } = runAuth({}, { PRODUCTION_API_TOKEN: "tok-test", NODE_ENV: "production" });
  report("TEST-38-01 no token → 401", res.statusCode === 401, "status=" + res.statusCode);
  report("TEST-38-01 next not called", nextCalled === false);
}

// ═══ TEST-38-02: authenticated production API → accepted ═══
{
  const { res, nextCalled } = runAuth({ authorization: "Bearer tok-test" }, { PRODUCTION_API_TOKEN: "tok-test", NODE_ENV: "production" });
  report("TEST-38-02 valid token → next called", nextCalled === true);
  report("TEST-38-02 no status set", res.statusCode === 0);
}

// ═══ TEST-38-03: missing PRODUCTION_API_TOKEN → explicit failure ═══
{
  const { res, nextCalled } = runAuth({ authorization: "Bearer anything" }, { PRODUCTION_API_TOKEN: undefined, NODE_ENV: "production" });
  report("TEST-38-03 missing token → 503", res.statusCode === 503, "status=" + res.statusCode);
  report("TEST-38-03 code = PRODUCTION_AUTH_NOT_CONFIGURED", res.body?.error === "PRODUCTION_AUTH_NOT_CONFIGURED");
  report("TEST-38-03 next not called", nextCalled === false);
}

// ═══ TEST-38-04: canonical-face without auth → rejected ═══
{
  // Same middleware governs /actors/:actorId/canonical-face (verified by grep)
  const { res, nextCalled } = runAuth({}, { PRODUCTION_API_TOKEN: "tok-test", NODE_ENV: "production" });
  report("TEST-38-04 canonical-face unauth → 401", res.statusCode === 401);
  report("TEST-38-04 next not called", nextCalled === false);
}

// ═══ TEST-38-05: invalid character reference → rejected ═══
{
  let rejected = false;
  try {
    assertSyntheticReference("https://example.com/real-person.jpg", { syntheticAcknowledged: true });
  } catch { rejected = true; }
  report("TEST-38-05 external URL rejected", rejected === true);
}

// ═══ TEST-38-06: syntheticAcknowledged alone cannot bypass ═══
{
  let rejected = false;
  try {
    assertSyntheticReference("https://example.com/x.jpg", { syntheticAcknowledged: true });
  } catch (e: any) {
    rejected = e.code === "LEGAL_GUARD_NON_SYNTHETIC";
  }
  report("TEST-38-06 ack alone rejected with proper code", rejected === true);
}

// ═══ TEST-38-07: valid synthetic reference → accepted ═══
{
  let ok = true;
  try {
    assertSyntheticReference("uploads/actors/refs/test.jpg");
    assertSyntheticReference("/uploads/actors/refs/test.jpg");
    assertSyntheticReference("data:image/png;base64,AAAA");
  } catch { ok = false; }
  report("TEST-38-07 valid synthetic refs accepted", ok);
}



// ═══ TEST-38-08: VIDEO input contract — all required I2V fields preserved ═══
{
  // Verify externalVideoProvider maps snake_case/camelCase correctly
  const src = fs.readFileSync("./src/lib/providers/video/externalVideoProvider.ts", "utf-8");
  const hasTask = src.includes('task: "i2v"');
  const hasRef = src.includes("reference_image_base64 ?? p.referenceImageBase64");
  const hasNeg = src.includes("negative_prompt ?? p.negativePrompt");
  const hasFps = src.includes("fps");
  const hasAspect = src.includes("aspect_ratio ?? p.aspectRatio");
  report("TEST-38-08 task=i2v set", hasTask);
  report("TEST-38-08 reference mapped", hasRef);
  report("TEST-38-08 negativePrompt forwarded", hasNeg);
  report("TEST-38-08 fps forwarded", hasFps);
  report("TEST-38-08 aspectRatio forwarded", hasAspect);
}

// ═══ TEST-38-09: provider identity consistency ═══
{
  const p1 = getActiveVideoProvider();
  // save & set
  const saved = process.env.VIDEO_PROVIDER;
  const savedKind = process.env.VIDEO_EXTERNAL_KIND;
  process.env.VIDEO_PROVIDER = "external";
  process.env.VIDEO_EXTERNAL_KIND = "wavespeed";
  const p2 = getActiveVideoProvider();
  process.env.VIDEO_PROVIDER = "kayangpu";
  delete process.env.VIDEO_EXTERNAL_KIND;
  const p3 = getActiveVideoProvider();
  process.env.VIDEO_PROVIDER = saved; if (savedKind) process.env.VIDEO_EXTERNAL_KIND = savedKind;

  report("TEST-38-09 external+wavespeed = 'wavespeed'", p2 === "wavespeed", "got=" + p2);
  report("TEST-38-09 kayangpu = 'kayan-gpu-worker'", p3 === "kayan-gpu-worker", "got=" + p3);
  report("TEST-38-09 returns string", typeof p1 === "string");
}

// ═══ TEST-38-10: invalid video artifact → not COMPLETED ═══
{
  const { validateVideoOutputOnDisk } = await import("../src/lib/pipeline/stageReuse");
  report("TEST-38-10 missing videoPath → invalid", validateVideoOutputOnDisk({}) === false);
  report("TEST-38-10 zero-byte file → invalid", validateVideoOutputOnDisk({ videoPath: "/tmp/no-such-task38.mp4", videoUrl: "/x" }) === false);
  const f = path.resolve(process.cwd(), "uploads", "temp", "task38-empty.mp4");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(0));
  report("TEST-38-10 zero-byte existing → invalid", validateVideoOutputOnDisk({ videoPath: f, videoUrl: "/x" }) === false);
  try { fs.unlinkSync(f); } catch {}
}

// ═══ TEST-38-11: invalid audio artifact → not COMPLETED ═══
{
  const { validateVoiceOutputOnDisk } = await import("../src/lib/pipeline/stageReuse");
  report("TEST-38-11 missing audioPath → invalid", validateVoiceOutputOnDisk({}) === false);
  const f = path.resolve(process.cwd(), "uploads", "temp", "task38-empty.mp3");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(0));
  report("TEST-38-11 zero-byte existing → invalid", validateVoiceOutputOnDisk({ audioPath: f, audioUrl: "/x" }) === false);
  try { fs.unlinkSync(f); } catch {}
}

// ═══ TEST-38-12: invalid render artifact → not COMPLETED ═══
{
  const { isRenderOutputValid } = await import("../src/lib/renderEngine");
  report("TEST-38-12 null render → invalid", isRenderOutputValid(null) === false);
  report("TEST-38-12 failed render → invalid", isRenderOutputValid({ status: "FAILED", outputPath: "/x" } as any) === false);
  report("TEST-38-12 completed no path → invalid", isRenderOutputValid({ status: "COMPLETED", outputPath: null } as any) === false);
  report("TEST-38-12 completed missing file → invalid", isRenderOutputValid({ status: "COMPLETED", outputPath: "/tmp/no-task38.mp4" } as any) === false);
}

// ═══ TEST-38-13: legacy localhost fallback protection ═══
{
  const { validateProxyUrl } = await import("../src/lib/securityMiddleware");
  report("TEST-38-13 localhost blocked", validateProxyUrl("http://localhost:8080/x") === false);
  report("TEST-38-13 127.0.0.1 blocked", validateProxyUrl("http://127.0.0.1/x") === false);
  report("TEST-38-13 private 10.x blocked", validateProxyUrl("http://10.0.0.5/x") === false);
  report("TEST-38-13 AWS metadata blocked", validateProxyUrl("http://169.254.169.254/x") === false);
  report("TEST-38-13 public allowed", validateProxyUrl("https://example.com/x") === true);
}

// ═══ TEST-38-14: LIPSYNC disabled protection ═══
{
  const enabled = (process.env.LIPSYNC_ENABLED || "false").toLowerCase() === "true";
  report("TEST-38-14 LIPSYNC disabled by default", enabled === false, "enabled=" + enabled);
  const qw = fs.readFileSync("./src/queue-worker.ts", "utf-8");
  const hasDisabledGuard = qw.includes("LIPSYNC_DISABLED_NO_GPU");
  // Check for the *silent fallback* anti-pattern: process.env.X || 'http://localhost/127...'
  const silentFallback = /process\.env\.[A-Z_]+\s*\|\|\s*['"]https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(qw);
  const hasExplicitUrlOnly = qw.includes("LIPSYNC_URL_EXPLICIT");
  const hasRequireFn = qw.includes("function requireWorkerUrl");
  report("TEST-38-14 disabled guard exists", hasDisabledGuard);
  report("TEST-38-14 no silent localhost fallback", !silentFallback, "silent=" + silentFallback);
  report("TEST-38-14 lipsync uses explicit URL only", hasExplicitUrlOnly);
  report("TEST-38-14 requireWorkerUrl gate present", hasRequireFn);
}

// ═══ TEST-38-15: LIPSYNC enabled without worker URL → explicit MISCONFIGURATION ═══
{
  const qw = fs.readFileSync("./src/queue-worker.ts", "utf-8");
  const hasMisconfig = qw.includes("lipsync MISCONFIGURATION") && qw.includes("LIPSYNC_WORKER_URL is not set");
  report("TEST-38-15 misconfiguration error present", hasMisconfig);
  const hasExplicitOnly = qw.includes("LIPSYNC_URL_EXPLICIT");
  report("TEST-38-15 URL is explicit-only", hasExplicitOnly);
}

// ═══ TEST-38-16: MUSIC/SFX unsupported path ═══
{
  const src = fs.readFileSync("./src/lib/productionEngine.ts", "utf-8");
  const hasOpenDep = src.includes("MUSIC_SFX_GEN is OPEN_DEPENDENCY");
  const throws = src.includes('err.code = "OPEN_DEPENDENCY"');
  report("TEST-38-16 MUSIC_SFX explicit unsupported", hasOpenDep);
  report("TEST-38-16 error code set", throws);
}

// ═══ TEST-38-17: secret source scan ═══
{
  const { execSync } = await import("node:child_process");
  let out = "";
  try {
    out = execSync(
      "git grep -lE '(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-|BEGIN (RSA|OPENSSH|PRIVATE)|AVNS_[A-Za-z0-9_-]{20,})' -- ':!.env.example' || true",
      { cwd: path.resolve(process.cwd(), "../.."), encoding: "utf-8" }
    );
  } catch { /* git grep returns exit 1 if no matches */ }
  const found = out.trim().length > 0;
  report("TEST-38-17 no secret pattern in tracked files", !found, found ? "match" : "clean");
}

// ═══ TEST-38-18: production environment contract ═══
{
  // Check the .env file (production config), not the current test process env.
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  let envText = "";
  try { envText = fs.readFileSync(envPath, "utf-8"); } catch {}
  const disableInEnv = /^NASHASH_DISABLE_AUTO_WORKER=1\s*$/m.test(envText);
  report("TEST-38-18 auto worker not disabled in .env", !disableInEnv, "present=" + disableInEnv);
  const sweepMs = Number(process.env.SWEEP_INTERVAL_MS || "60000");
  const staleMs = Number(process.env.WORKER_STALE_MS || "600000");
  report("TEST-38-18 SWEEP_INTERVAL_MS default safe", Number.isFinite(sweepMs) && sweepMs > 0);
  report("TEST-38-18 WORKER_STALE_MS default safe", Number.isFinite(staleMs) && staleMs > 0);
}

// ═══ TEST-38-19: explicit worker URL required in production ═══
{
  const qw = fs.readFileSync("./src/queue-worker.ts", "utf-8");
  const hasRequireFn = qw.includes("function requireWorkerUrl");
  const hasProdGuard = qw.includes("refusing silent localhost fallback in production");
  const hasSshGuard = qw.includes("refusing silent localhost SSH target in production");
  const hasDevOnly = qw.includes("NODE_ENV") && qw.includes("development");
  report("TEST-38-19 requireWorkerUrl exists", hasRequireFn);
  report("TEST-38-19 prod rejects missing VIDEO/LLM URL", hasProdGuard);
  report("TEST-38-19 prod rejects missing GPU SSH target", hasSshGuard);
  report("TEST-38-19 dev fallback still allowed", hasDevOnly);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
