import fs from "node:fs";
import path from "node:path";
import {
  createRenderJob,
  getRenderJobStatus,
  findRenderJobByPipelineRun,
  isRenderOutputValid,
  runRenderPipeline,
} from "../src/lib/renderEngine.ts";

const PIPELINE_RUN_ID = "test-task34-reuse-" + Date.now();
let passed = 0, failed = 0;
const report = (name, ok, extra = "") => {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " :: " + extra : ""));
  ok ? passed++ : failed++;
};

// helper: create a fake COMPLETED render row with a given file state
async function seedCompleted(runId, fileState /* 'valid' | 'missing' | 'zero' */) {
  const clips = [{ id: "c1", assetUrl: "/uploads/renders/dummy.mp4", durationSeconds: 1, order: 1 }];
  const job = await createRenderJob({
    projectId: 1,
    clips,
    pipelineRunId: runId,
  });
  // write DB fields directly via update
  const { db, renderJobsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  let outputPath = null;
  if (fileState !== "missing") {
    const dir = path.resolve(process.cwd(), "uploads", "renders");
    fs.mkdirSync(dir, { recursive: true });
    outputPath = path.join(dir, `test_reuse_${job.id}.mp4`);
    if (fileState === "valid") fs.writeFileSync(outputPath, Buffer.from("FAKEMP4"));
    if (fileState === "zero")   fs.writeFileSync(outputPath, Buffer.alloc(0));
  }
  await db.update(renderJobsTable).set({
    status: "COMPLETED",
    outputPath,
    outputUrl: outputPath ? "/uploads/renders/x.mp4" : null,
    duration: 1,
    sizeBytes: fileState === "valid" ? 7 : 0,
  }).where(eq(renderJobsTable.id, job.id));
  return { jobId: job.id, outputPath };
}

// ─── TEST-34-01: completed + valid file → REUSE ───
{
  const runId = PIPELINE_RUN_ID + "-01";
  const { jobId, outputPath } = await seedCompleted(runId, "valid");
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-01 completed+valid → find returns job", found?.id === jobId);
  report("TEST-34-01 completed+valid → isRenderOutputValid=true", isRenderOutputValid(found) === true);
  try { if (outputPath) fs.unlinkSync(outputPath); } catch {}
}

// ─── TEST-34-02: completed + missing file → rebuild (invalid) ───
{
  const runId = PIPELINE_RUN_ID + "-02";
  const { jobId } = await seedCompleted(runId, "missing");
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-02 completed+missing → find returns job", found?.id === jobId);
  report("TEST-34-02 completed+missing → isRenderOutputValid=false", isRenderOutputValid(found) === false);
}

// ─── TEST-34-03: completed + zero byte → rebuild (invalid) ───
{
  const runId = PIPELINE_RUN_ID + "-03";
  const { jobId, outputPath } = await seedCompleted(runId, "zero");
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-03 completed+zero → find returns job", found?.id === jobId);
  report("TEST-34-03 completed+zero → isRenderOutputValid=false", isRenderOutputValid(found) === false);
  try { if (outputPath) fs.unlinkSync(outputPath); } catch {}
}

// ─── TEST-34-04: PROCESSING → reuse existing job (find returns it) ───
{
  const runId = PIPELINE_RUN_ID + "-04";
  const job = await createRenderJob({ projectId: 1, clips: [{ id: "c1", assetUrl: "/uploads/renders/dummy.mp4", durationSeconds: 1, order: 1 }], pipelineRunId: runId });
  const { db, renderJobsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db.update(renderJobsTable).set({ status: "PROCESSING" }).where(eq(renderJobsTable.id, job.id));
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-04 PROCESSING → find returns existing job", found?.id === job.id);
  report("TEST-34-04 PROCESSING → isRenderOutputValid=false", isRenderOutputValid(found) === false);
}

// ─── TEST-34-05: QUEUED → reuse existing job (find returns it) ───
{
  const runId = PIPELINE_RUN_ID + "-05";
  const job = await createRenderJob({ projectId: 1, clips: [{ id: "c1", assetUrl: "/uploads/renders/dummy.mp4", durationSeconds: 1, order: 1 }], pipelineRunId: runId });
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-05 QUEUED → find returns existing job", found?.id === job.id);
  report("TEST-34-05 QUEUED → isRenderOutputValid=false", isRenderOutputValid(found) === false);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
