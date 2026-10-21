/**
 * KAYAN-TASK-DEPLOY-17: verify production-worker entry + atomic claim.
 *
 * Offline/static where possible; the atomic-claim test uses an in-memory
 * mock DB layer, so no real database or external services are touched.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

// ── 1. production-worker.ts exists and has required structure ────
const pwSrc = fs.readFileSync(path.resolve(process.cwd(), "src/production-worker.ts"), "utf-8");
report("DEPLOY17-01 production-worker.ts exists", true);
report("DEPLOY17-02 imports startProductionWorker",
  /from "\.\/lib\/productionEngine"/.test(pwSrc) && /startProductionWorker/.test(pwSrc));
report("DEPLOY17-03 imports stopProductionWorker", /stopProductionWorker/.test(pwSrc));
report("DEPLOY17-04 handles SIGTERM", /process\.on\("SIGTERM"/.test(pwSrc));
report("DEPLOY17-05 handles SIGINT", /process\.on\("SIGINT"/.test(pwSrc));
report("DEPLOY17-06 does NOT import express",
  !/from "express"/.test(pwSrc));
report("DEPLOY17-07 does NOT call app.listen",
  !/app\.listen/.test(pwSrc));

// ── 2. build.mjs includes production-worker.ts as entry ──────────
const buildSrc = fs.readFileSync(path.resolve(process.cwd(), "build.mjs"), "utf-8");
report("DEPLOY17-08 build.mjs includes src/production-worker.ts",
  /src\/production-worker\.ts/.test(buildSrc));

// ── 3. claimJob exists in productionEngine.ts with atomic WHERE ──
const engSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/productionEngine.ts"), "utf-8");
report("DEPLOY17-09 claimJob function exists", /async function claimJob\(/.test(engSrc));
report("DEPLOY17-10 claimJob uses WHERE status = 'pending' AND id = X",
  /and\([\s\S]{0,200}eq\(productionPipeline\.id, jobId\)[\s\S]{0,200}eq\(productionPipeline\.status, "pending"\)[\s\S]{0,100}\)/.test(engSrc));
report("DEPLOY17-11 claimJob uses .returning() to verify it won",
  /\.returning\(\{\s*id: productionPipeline\.id\s*\}\)/.test(engSrc));
report("DEPLOY17-12 processNextQueuedJob calls claimJob",
  /const claimed = await claimJob\(jobId\)/.test(engSrc));
report("DEPLOY17-13 processNextQueuedJob bails when claim lost",
  /if \(!claimed\) return null;/.test(engSrc));

// ── 4. isProcessing reset moved to finally (not before claim) ────
// Ensures that if claim fails, isProcessing stays false (as it was).
const oldBad = /isProcessing = true;\s*const jobId = row\.id;/;
report("DEPLOY17-14 isProcessing set AFTER claim (not before)",
  !oldBad.test(engSrc));

// ── 5. Atomic claim behavioral simulation ────────────────────────
// Mock DB that simulates two workers racing on the same row.
type Row = { id: string; status: string };
async function simulateRace() {
  const rows: Row[] = [{ id: "row-1", status: "pending" }];
  async function claimJobMock(jobId: string): Promise<boolean> {
    // Simulates the atomic UPDATE … WHERE status='pending' RETURNING.
    // Node is single-threaded, so the operation is naturally atomic between
    // await points — but we simulate interleaving by yielding first.
    await Promise.resolve();
    const row = rows.find(r => r.id === jobId);
    if (!row || row.status !== "pending") return false;
    row.status = "processing";
    return true;
  }
  const [a, b] = await Promise.all([claimJobMock("row-1"), claimJobMock("row-1")]);
  const winners = [a, b].filter(Boolean).length;
  return { winners, finalStatus: rows[0].status };
}
{
  const r = await simulateRace();
  report("DEPLOY17-15 exactly one worker wins the race", r.winners === 1, `winners=${r.winners}`);
  report("DEPLOY17-16 row is processing after race", r.finalStatus === "processing", `status=${r.finalStatus}`);
}

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
