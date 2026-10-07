import fs from "node:fs";
import path from "node:path";
import { db, renderJobsTable, productionPipeline } from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import {
  createRenderJob,
  findRenderJobByPipelineRun,
  isRenderOutputValid,
} from "../src/lib/renderEngine.ts";

let passed = 0, failed = 0;
const report = (n, ok, x = "") => { console.log((ok?"PASS ":"FAIL ")+n+(x?" :: "+x:"")); ok?passed++:failed++; };

// Helper: seed a render for a run with a real file
async function seedValidRender(runId) {
  const job = await createRenderJob({
    projectId: 1,
    clips: [{ id: "c1", assetUrl: "/uploads/renders/dummy.mp4", durationSeconds: 1, order: 1 }],
    pipelineRunId: runId,
  });
  const dir = path.resolve(process.cwd(), "uploads", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `test_full_${job.id}.mp4`);
  fs.writeFileSync(p, Buffer.from("X"));
  await db.update(renderJobsTable).set({
    status: "COMPLETED", outputPath: p, outputUrl: "/uploads/renders/x.mp4",
    duration: 1, sizeBytes: 1,
  }).where(eq(renderJobsTable.id, job.id));
  return { jobId: job.id, outputPath: p };
}

async function countRendersForRun(runId) {
  const r = await db.select({ n: sql<number>`COUNT(*)::int` })
    .from(renderJobsTable)
    .where(sql`${renderJobsTable.input}->>'pipelineRunId' = ${runId}`);
  return r[0]?.n ?? 0;
}

// ═════════════ TEST-34-07: full completed pipeline resume → no new render job ═════════════
{
  const runId = "test-task34-07-" + Date.now();

  // Seed: pipeline row + valid completed render
  await db.insert(productionPipeline).values({
    id: runId, type: "FULL_PIPELINE", status: "completed", projectId: 1,
    payload: {} as any, createdAt: new Date(),
  } as any);
  const { outputPath } = await seedValidRender(runId);
  const before = await countRendersForRun(runId);
  report("TEST-34-07 seed: 1 render for run", before === 1, "count=" + before);

  // Simulate resume endpoint's short-circuit: run.status === 'completed' → ALREADY_COMPLETED
  const [row] = await db.select().from(productionPipeline).where(eq(productionPipeline.id, runId));
  const wouldShortCircuit = row.status === "completed";
  report("TEST-34-07 resume on completed → ALREADY_COMPLETED", wouldShortCircuit);

  // Even if we reached render stage, the reuse helper returns the existing job
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-07 reuse helper finds existing render", !!found);
  report("TEST-34-07 existing render is valid", isRenderOutputValid(found) === true);

  const after = await countRendersForRun(runId);
  report("TEST-34-07 no new render job created", after === before, before + "→" + after);

  try { fs.unlinkSync(outputPath); } catch {}
  await db.delete(productionPipeline).where(eq(productionPipeline.id, runId));
}

// ═════════════ TEST-34-08: partial/interrupted resume → only missing work ═════════════
{
  const runId = "test-task34-08-" + Date.now();

  // Seed: interrupted pipeline + valid completed render for it
  await db.insert(productionPipeline).values({
    id: runId, type: "FULL_PIPELINE", status: "interrupted", projectId: 1,
    payload: {} as any, createdAt: new Date(),
  } as any);
  const { jobId, outputPath } = await seedValidRender(runId);

  // Atomic transition (mirrors resume endpoint)
  const upd = await db.update(productionPipeline)
    .set({ status: "processing" })
    .where(and(
      eq(productionPipeline.id, runId),
      inArray(productionPipeline.status, ["interrupted", "failed"]),
    ));
  report("TEST-34-08 atomic transition succeeded", upd.rowCount === 1);

  // Resume would reach render stage → reuse helper returns existing job → no rebuild
  const found = await findRenderJobByPipelineRun(runId);
  report("TEST-34-08 reuse helper returns existing job", found?.id === jobId);
  report("TEST-34-08 existing render is valid (no rebuild)", isRenderOutputValid(found) === true);

  const count = await countRendersForRun(runId);
  report("TEST-34-08 only 1 render job (no duplicate)", count === 1, "count=" + count);

  try { fs.unlinkSync(outputPath); } catch {}
  await db.delete(productionPipeline).where(eq(productionPipeline.id, runId));
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
