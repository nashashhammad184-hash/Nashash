/**
 * KAYAN-7.1: tests for SERVICE_ROLE consistency + DEAD provider warnings.
 * - H1..H4: health route reports the injected SERVICE_ROLE (or falls back to api).
 * - W1..W6: dead-provider warnings fire ONLY when the role uses that provider.
 */
import express from "express";
import healthRouter from "../src/routes/health";
import { validateEnv } from "../src/lib/validateEnv";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

async function fetchHealthz(role: string): Promise<any> {
  process.env.SERVICE_ROLE = role;
  const app = express();
  app.use("/api", healthRouter);
  return await new Promise((resolve) => {
    const srv = app.listen(0, async () => {
      const addr: any = srv.address();
      const r = await fetch(`http://127.0.0.1:${addr.port}/api/healthz`);
      const j = await r.json();
      srv.close(() => resolve(j));
    });
  });
}

process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.PRODUCTION_API_TOKEN = "t";
process.env.STORAGE_PROVIDER = "local";
process.env.SCRIPT_PROVIDER = "local";

report("H1 role=api",       (await fetchHealthz("api")).role === "api");
report("H2 role=queue-worker", (await fetchHealthz("queue-worker")).role === "queue-worker");
report("H3 role=production-worker", (await fetchHealthz("production-worker")).role === "production-worker");
report("H4 unknown→api",    (await fetchHealthz("bogus")).role === "api");

function reset() {
  ["VIDEO_PROVIDER","VIDEO_EXTERNAL_KIND","SCRIPT_PROVIDER","GROQ_API_KEY","GROQ_MODEL","WAVESPEED_API_KEY","DEEPGRAM_API_KEY","GPU_SSH_TARGET","STORAGE_PROVIDER","PRODUCTION_API_TOKEN"].forEach((k) => delete (process.env as any)[k]);
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://x";
}

reset(); process.env.PRODUCTION_API_TOKEN="t"; process.env.STORAGE_PROVIDER="local"; process.env.SCRIPT_PROVIDER="local";
{
  const r = validateEnv("api");
  report("W1 api/local no SCRIPT_DEAD", !r.warnings.some(w => w.includes("SCRIPT_PROVIDER_DEAD")));
}

reset(); process.env.SCRIPT_PROVIDER="local";
{
  const r = validateEnv("queue-worker");
  report("W2 qw/local SCRIPT_DEAD fires", r.warnings.some(w => w.includes("SCRIPT_PROVIDER_DEAD")));
}

reset(); process.env.SCRIPT_PROVIDER="groq"; process.env.GROQ_API_KEY="k"; process.env.GROQ_MODEL="m";
{
  const r = validateEnv("queue-worker");
  report("W3 qw/groq no SCRIPT_DEAD", !r.warnings.some(w => w.includes("SCRIPT_PROVIDER_DEAD")));
}

reset(); process.env.VIDEO_PROVIDER="kayangpu"; process.env.GPU_SSH_TARGET="ubuntu@127.0.0.1"; process.env.DEEPGRAM_API_KEY="d";
{
  const r = validateEnv("production-worker");
  report("W4 pw/kayangpu VIDEO_DEAD fires", r.warnings.some(w => w.includes("VIDEO_PROVIDER_DEAD")));
}

reset(); process.env.VIDEO_PROVIDER="external"; process.env.VIDEO_EXTERNAL_KIND="wavespeed"; process.env.WAVESPEED_API_KEY="k"; process.env.DEEPGRAM_API_KEY="d";
{
  const r = validateEnv("production-worker");
  report("W5 pw/wavespeed no VIDEO_DEAD", !r.warnings.some(w => w.includes("VIDEO_PROVIDER_DEAD")));
}

reset(); process.env.PRODUCTION_API_TOKEN="t"; process.env.STORAGE_PROVIDER="local"; process.env.SCRIPT_PROVIDER="local";
{
  const r = validateEnv("api");
  report("W6 api/kayangpu-default no VIDEO_DEAD", !r.warnings.some(w => w.includes("VIDEO_PROVIDER_DEAD")));
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
