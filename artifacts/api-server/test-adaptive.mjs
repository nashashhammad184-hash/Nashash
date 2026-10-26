import pg from "pg";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const NEON = process.env.NEON;
const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

const worker = spawn("node", ["dist/production-worker.mjs"], {
  env: {
    ...process.env,
    DATABASE_URL: NEON,
    QUEUE_DATABASE_URL: NEON,
    KAYAN_ENV_FILE: "/dev/null",
    NODE_ENV: "production",
    NASHASH_DISABLE_AUTO_WORKER: "1",
    PRODUCTION_WORKER_POLL_ACTIVE_MS: "1000",
    PRODUCTION_WORKER_POLL_WARM_MS: "3000",
    PRODUCTION_WORKER_POLL_IDLE_MS: "6000",
    PRODUCTION_WORKER_ACTIVE_THRESHOLD: "3",
    PRODUCTION_WORKER_IDLE_THRESHOLD: "6",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
worker.stdout.on("data", d => process.stdout.write("[worker] " + d));
worker.stderr.on("data", d => { const s = String(d); if (!s.includes("SECURITY") && !s.includes("sslmode") && !s.includes("trace-warnings")) process.stdout.write("[worker-err] " + s); });

async function insertJob(c, id) {
  const t0 = Date.now();
  await c.query("INSERT INTO production_pipeline (id, type, status, payload) VALUES ($1, 'VIDEO_GEN', 'pending', $2::jsonb)",
    [id, JSON.stringify({ prompt: "test", task: "t2v" })]);
  return t0;
}

async function waitPickup(c, id, t0, deadlineSec = 120) {
  for (let i = 0; i < deadlineSec; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await c.query("SELECT status FROM production_pipeline WHERE id=$1", [id]);
    if (r.rows.length === 0) return -1;
    if (r.rows[0].status !== "pending") return Date.now() - t0;
  }
  return -1;
}

(async () => {
  await new Promise(r => setTimeout(r, 3000));
  const c = new pg.Client({ connectionString: NEON, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Test 1: Active state (immediate)
  log("Test 1: ACTIVE state");
  const id1 = `adaptive-active-${Date.now()}`;
  const t1 = await insertJob(c, id1);
  const p1 = await waitPickup(c, id1, t1, 30);
  log(`ACTIVE pickup=${p1}ms`);
  await c.query("DELETE FROM production_pipeline WHERE id=$1", [id1]);

  // Wait for IDLE state (empty polls > 6 with idle=6s → ~36s)
  log("Waiting 40s for IDLE state...");
  await new Promise(r => setTimeout(r, 40000));

  // Test 2: Idle state
  log("Test 2: IDLE state");
  const id2 = `adaptive-idle-${Date.now()}`;
  const t2 = await insertJob(c, id2);
  const p2 = await waitPickup(c, id2, t2, 120);
  log(`IDLE pickup=${p2}ms`);
  await c.query("DELETE FROM production_pipeline WHERE id=$1", [id2]);

  await c.end();
  worker.kill("SIGTERM");
  log(`SUMMARY: active=${p1}ms idle=${p2}ms`);
  process.exit(0);
})().catch(e => { console.error(e); worker.kill(); process.exit(1); });
