import { db, productionPipeline } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getOrCreateChildJob } from "./src/lib/pipeline/childJobs.ts";

const before = await db.select({ n: sql<number>`COUNT(*)::int` }).from(productionPipeline)
  .where(and(eq(productionPipeline.type, "VIDEO_GEN"), eq(productionPipeline.status, "completed")));
console.log("VIDEO_COMPLETED_BEFORE=", before[0].n);

const runId = "task42-resume-" + Date.now();
const payload = { projectId: 1, prompt: "x", shotId: 1, task: "i2v" as const, referenceImageBase64: "a".repeat(64) };
const r1 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", 1, payload);
const r2 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", 1, payload);
console.log("SAME_JOB_ID=", r1.id === r2.id, "id=", r1.id);

const after = await db.select({ n: sql<number>`COUNT(*)::int` }).from(productionPipeline)
  .where(and(eq(productionPipeline.type, "VIDEO_GEN"), eq(productionPipeline.status, "completed")));
console.log("VIDEO_COMPLETED_AFTER=", after[0].n);

await db.delete(productionPipeline).where(eq(productionPipeline.parentRunId, runId));
console.log("CLEANUP_DONE");
process.exit(0);
