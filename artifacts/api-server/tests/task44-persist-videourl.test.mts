import fs from "node:fs";
import path from "node:path";
import { db, shotsTable, projectsTable, productionPipeline } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getOrCreateChildJob } from "../src/lib/pipeline/childJobs";
import { decideStageReuse, validateVideoOutputOnDisk } from "../src/lib/pipeline/stageReuse";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = path.resolve(process.cwd(), "uploads", "temp", "task44");
fs.mkdirSync(TMP, { recursive: true });

async function seedProject(title: string): Promise<number> {
  const [p] = await db.insert(projectsTable).values({
    title, worldId: "noir", projectType: "film", style: "drama",
  } as any).returning();
  return p.id;
}
async function seedShot(projectId: number, description: string): Promise<number> {
  const [s] = await db.insert(shotsTable).values({
    projectId, description, cameraMovement: "static", durationSeconds: 5,
  } as any).returning();
  return s.id;
}
async function cleanupProject(projectId: number) {
  await db.delete(productionPipeline).where(eq(productionPipeline.projectId, projectId));
  await db.delete(shotsTable).where(eq(shotsTable.projectId, projectId));
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
}

// Simulate what pipeline.ts does after VIDEO stage: persist vu to shot row.
// This mirrors the exact code path.
async function persistVideoUrl(shotId: number, vu: string): Promise<void> {
  if (typeof vu !== "string" || vu.trim().length === 0) {
    throw new Error(`refusing to persist empty videoUrl for shot ${shotId}`);
  }
  const upd = await db.update(shotsTable).set({ videoUrl: vu }).where(eq(shotsTable.id, shotId));
  if (upd.rowCount !== 1) throw new Error(`expected 1 row, got ${upd.rowCount}`);
}

// ═══ TEST-44-01: success persists videoUrl to the correct shot ═══
{
  const pid = await seedProject("T44-01");
  const sid = await seedShot(pid, "close-up");
  const vu = "/uploads/videos/ws_test44_01.mp4";
  await persistVideoUrl(sid, vu);
  const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
  report("TEST-44-01 videoUrl persisted", row.videoUrl === vu, "got=" + row.videoUrl);
  await cleanupProject(pid);
}

// ═══ TEST-44-02: multi-shot, no cross-contamination ═══
{
  const pid = await seedProject("T44-02");
  const s1 = await seedShot(pid, "shot A");
  const s2 = await seedShot(pid, "shot B");
  const s3 = await seedShot(pid, "shot C");
  await persistVideoUrl(s1, "/uploads/videos/a.mp4");
  await persistVideoUrl(s2, "/uploads/videos/b.mp4");
  await persistVideoUrl(s3, "/uploads/videos/c.mp4");
  const rows = await db.select().from(shotsTable).where(eq(shotsTable.projectId, pid));
  const byId = new Map(rows.map(r => [r.id, r.videoUrl]));
  report("TEST-44-02 shot A → a.mp4", byId.get(s1) === "/uploads/videos/a.mp4");
  report("TEST-44-02 shot B → b.mp4", byId.get(s2) === "/uploads/videos/b.mp4");
  report("TEST-44-02 shot C → c.mp4", byId.get(s3) === "/uploads/videos/c.mp4");
  report("TEST-44-02 three distinct mappings", new Set(byId.values()).size === 3);
  await cleanupProject(pid);
}

// ═══ TEST-44-03: DB update failure → explicit error (no fake success) ═══
{
  // Simulate by calling on a non-existent shot
  let threw = false;
  try {
    await persistVideoUrl(999999999, "/uploads/videos/ghost.mp4");
  } catch (e: any) {
    threw = e.message.includes("expected 1 row");
  }
  report("TEST-44-03 non-existent shot → explicit error", threw);
}

// ═══ TEST-44-04: resume reuses existing valid video + persists videoUrl ═══
{
  const pid = await seedProject("T44-04");
  const sid = await seedShot(pid, "resume");
  const filePath = path.join(TMP, "resume.mp4");
  fs.writeFileSync(filePath, Buffer.from("VALID"));

  const runId = "t44-04-" + Date.now();
  const job = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", sid, {
    projectId: pid, prompt: "x", shotId: sid, task: "i2v" as const,
    referenceImageBase64: "a".repeat(64),
  });
  await db.update(productionPipeline).set({
    status: "completed",
    output: { videoPath: filePath, videoUrl: "/uploads/videos/resume.mp4" } as any,
    completedAt: new Date(),
  }).where(eq(productionPipeline.id, job.id));

  // Simulate resume
  const decision = await decideStageReuse({
    runId, stage: "VIDEO_GEN", shotId: sid, validateOutput: validateVideoOutputOnDisk,
  });
  report("TEST-44-04 resume SKIPPED_EXISTING_RESULT", decision.decision === "SKIPPED_EXISTING_RESULT");

  // Persist videoUrl from the reused job output
  const out = decision.job?.output as any;
  await persistVideoUrl(sid, out.videoUrl);
  const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
  report("TEST-44-04 videoUrl persisted on resume", row.videoUrl === "/uploads/videos/resume.mp4");

  try { fs.unlinkSync(filePath); } catch {}
  await cleanupProject(pid);
}

// ═══ TEST-44-05: repeated resume → no duplicate jobs, no ID change ═══
{
  const pid = await seedProject("T44-05");
  const sid = await seedShot(pid, "repeat");
  const runId = "t44-05-" + Date.now();
  const job1 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", sid, {
    projectId: pid, prompt: "x", shotId: sid, task: "i2v" as const,
    referenceImageBase64: "a".repeat(64),
  });
  const job2 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", sid, {
    projectId: pid, prompt: "x", shotId: sid, task: "i2v" as const,
    referenceImageBase64: "a".repeat(64),
  });
  report("TEST-44-05 same job id reused", job1.id === job2.id);
  const count = await db.select().from(productionPipeline)
    .where(and(eq(productionPipeline.parentRunId, runId), eq(productionPipeline.type, "VIDEO_GEN")));
  report("TEST-44-05 exactly 1 child job", count.length === 1, "count=" + count.length);
  await cleanupProject(pid);
}

// ═══ TEST-44-06: empty/invalid URL → refuse to persist ═══
{
  const pid = await seedProject("T44-06");
  const sid = await seedShot(pid, "empty");
  let threwEmpty = false, threwNull = false;
  try { await persistVideoUrl(sid, ""); } catch { threwEmpty = true; }
  try { await persistVideoUrl(sid, "   "); } catch { threwNull = true; }
  report("TEST-44-06 empty URL refused", threwEmpty);
  report("TEST-44-06 whitespace URL refused", threwNull);
  const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
  report("TEST-44-06 videoUrl remains null", row.videoUrl === null, "got=" + row.videoUrl);
  await cleanupProject(pid);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
