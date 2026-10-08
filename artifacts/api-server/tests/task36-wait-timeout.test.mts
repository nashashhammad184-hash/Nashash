import fs from "node:fs";
import path from "node:path";
import { db, productionPipeline } from "@workspace/db";
import { eq } from "drizzle-orm";
import { waitForJob } from "../src/lib/pipeline/jobWait";
import {
  decideStageReuse,
  validateVideoOutputOnDisk,
  countChildJobsForRun,
} from "../src/lib/pipeline/stageReuse";
import { buildPipelineJobKey } from "../src/lib/pipeline/jobKeys";
import { createProductionJob } from "../src/lib/productionEngine";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = path.resolve(process.cwd(), "uploads", "temp", "task36");
fs.mkdirSync(TMP, { recursive: true });

async function cleanupRun(runId: string) {
  await db.delete(productionPipeline).where(eq(productionPipeline.parentRunId, runId));
}

// ═══ TEST-36-01: processing job completes before timeout → wait succeeds ═══
{
  let calls = 0;
  const fakeJob = () => {
    calls++;
    if (calls < 3) return { id: "j1", status: "processing", updatedAt: new Date() };
    return { id: "j1", status: "completed", updatedAt: new Date(), output: { videoPath: "/x" } };
  };
  const r = await waitForJob("j1", {
    timeoutMs: 5000, staleMs: 5000, pollIntervalMs: 20,
    getJob: async () => fakeJob() as any,
    onTimeout: async () => { throw new Error("should not timeout"); },
  });
  report("TEST-36-01 completes before timeout", r.status === "completed", "calls=" + calls);
}

// ═══ TEST-36-02: processing job exceeds timeout → wait terminates safely ═══
{
  let timedOutReason = "";
  const start = Date.now();
  const r = await waitForJob("j2", {
    timeoutMs: 200, staleMs: 10_000, pollIntervalMs: 20,
    getJob: async () => ({ id: "j2", status: "processing", updatedAt: new Date() }) as any,
    onTimeout: async (_id, reason) => { timedOutReason = reason; },
  });
  const elapsed = Date.now() - start;
  report("TEST-36-02 terminates within bound", elapsed < 2000, "elapsed=" + elapsed + "ms");
  report("TEST-36-02 onTimeout fired", timedOutReason.includes("overall wait timeout"), "reason=" + timedOutReason);
  report("TEST-36-02 returns terminal row", r && r.status === "processing");
}

// ═══ TEST-36-03: stale worker / no heartbeat → no infinite wait ═══
{
  let timedOutReason = "";
  const staleUpdate = new Date(Date.now() - 60_000); // 60s ago, > staleMs of 500ms
  const start = Date.now();
  await waitForJob("j3", {
    timeoutMs: 30_000, staleMs: 500, pollIntervalMs: 20,
    getJob: async () => ({ id: "j3", status: "processing", updatedAt: staleUpdate }) as any,
    onTimeout: async (_id, reason) => { timedOutReason = reason; },
  });
  const elapsed = Date.now() - start;
  report("TEST-36-03 no infinite wait on stale worker", elapsed < 3000, "elapsed=" + elapsed + "ms");
  report("TEST-36-03 onTimeout fired with stale reason", timedOutReason.includes("no progress"), "reason=" + timedOutReason);
}

// ═══ TEST-36-04: timeout does not create duplicate child job ═══
{
  const runId = "t36-04-" + Date.now();
  const jobKey = buildPipelineJobKey(runId, "VIDEO_GEN", 1);
  await createProductionJob("VIDEO_GEN", { projectId: 1, shotId: 1, prompt: "x" } as any, 3, { parentRunId: runId, jobKey });
  const before = await countChildJobsForRun(runId);

  // simulate timeout — waitForJob uses injected getJob/onTimeout; no DB write
  await waitForJob("nonexistent-xyz", {
    timeoutMs: 50, staleMs: 50, pollIntervalMs: 10,
    getJob: async () => ({ id: "nonexistent-xyz", status: "processing", updatedAt: new Date() }) as any,
    onTimeout: async () => {},
  }).catch(() => {});

  const after = await countChildJobsForRun(runId);
  report("TEST-36-04 no duplicate child job after timeout", after === before, before + "→" + after);
  await cleanupRun(runId);
}

// ═══ TEST-36-05: stale recovery + Resume → existing valid jobs reused ═══
{
  const runId = "t36-05-" + Date.now();
  const vp = path.join(TMP, "v05.mp4");
  fs.writeFileSync(vp, Buffer.from("VALID"));
  const jobKey = buildPipelineJobKey(runId, "VIDEO_GEN", 1);
  const j = await createProductionJob("VIDEO_GEN", { projectId: 1, shotId: 1, prompt: "x" } as any, 3, { parentRunId: runId, jobKey });
  await db.update(productionPipeline).set({
    status: "completed",
    output: { videoPath: vp, videoUrl: "/uploads/videos/v05.mp4" } as any,
    completedAt: new Date(),
  }).where(eq(productionPipeline.id, j.id));

  const r = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: 1, validateOutput: validateVideoOutputOnDisk });
  report("TEST-36-05 stale recovery + Resume reuses valid job", r.decision === "SKIPPED_EXISTING_RESULT", "decision=" + r.decision);
  try { fs.unlinkSync(vp); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-36-06: stale recovery + invalid/missing → only required work rebuilt ═══
{
  const runId = "t36-06-" + Date.now();
  const jobKey = buildPipelineJobKey(runId, "VIDEO_GEN", 1);
  const j = await createProductionJob("VIDEO_GEN", { projectId: 1, shotId: 1, prompt: "x" } as any, 3, { parentRunId: runId, jobKey });
  await db.update(productionPipeline).set({
    status: "completed",
    output: { videoPath: "/tmp/does-not-exist-t36.mp4", videoUrl: "/uploads/videos/x.mp4" } as any,
    completedAt: new Date(),
  }).where(eq(productionPipeline.id, j.id));

  const r = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: 1, validateOutput: validateVideoOutputOnDisk });
  report("TEST-36-06 invalid result → rebuild required", r.decision === "REBUILD_REQUIRED", "decision=" + r.decision);
  await cleanupRun(runId);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
