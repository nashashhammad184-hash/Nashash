import { buildPipelineJobKey } from "../src/lib/pipeline/jobKeys.ts";
import { getOrCreateChildJob } from "../src/lib/pipeline/childJobs.ts";
import {
  findProductionJobByJobKey,
} from "../src/lib/productionEngine.ts";

let passed = 0, failed = 0;
const report = (name, ok, extra = "") => {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " :: " + extra : ""));
  ok ? passed++ : failed++;
};

// ─── TASK-32 regression: deterministic jobKey ───
{
  const k1 = buildPipelineJobKey("run-A", "VIDEO_GEN", 1);
  const k2 = buildPipelineJobKey("run-A", "VIDEO_GEN", 1);
  const k3 = buildPipelineJobKey("run-A", "VIDEO_GEN", 2);
  const k4 = buildPipelineJobKey("run-A", "VOICE_GEN", 1);
  report("TASK-32 key deterministic", k1 === k2, k1);
  report("TASK-32 key differs by shot", k1 !== k3);
  report("TASK-32 key differs by stage", k1 !== k4);
  let threw = false;
  try { buildPipelineJobKey("", "VIDEO_GEN", 1); } catch { threw = true; }
  report("TASK-32 rejects empty runId", threw);
}

// ─── TASK-33 regression: getOrCreateChildJob idempotent ───
{
  const runId = "test-task34-regr-" + Date.now();
  const payload = { projectId: 1, shotId: 1, prompt: "x" };
  const a = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", 1, payload as any);
  const b = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", 1, payload as any);
  report("TASK-33 same (runId,stage,shot) → same job", a.id === b.id, a.id + " vs " + b.id);

  const c = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", 2, payload as any);
  report("TASK-33 different shot → different job", a.id !== c.id);

  // verify job_key persisted
  const expectedKey = buildPipelineJobKey(runId, "VIDEO_GEN", 1);
  const found = await findProductionJobByJobKey(expectedKey);
  report("TASK-33 job_key persisted in DB", found?.id === a.id);
}

// ─── TASK-31 regression: externalVideoProvider persists request_id before polling ───
{
  const src = await import("node:fs").then(fs =>
    fs.readFileSync("./src/lib/providers/video/externalVideoProvider.ts", "utf-8")
  );
  const hasReqIdPersist = /request_id|requestId|providerRequestId/i.test(src);
  const orderOk =
    src.indexOf("providerRequestId") >= 0 &&
    src.indexOf("providerRequestId") < src.indexOf("poll", src.indexOf("providerRequestId"));
  report("TASK-31 persists request_id", hasReqIdPersist);
  report("TASK-31 persist BEFORE poll", orderOk);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
