import fs from "node:fs";
import path from "node:path";
import { db, shotsTable, projectsTable, productionPipeline } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { resolveShotId, persistVideoUrlToShot } from "../src/lib/videoShotLink";
import { getOrCreateChildJob } from "../src/lib/pipeline/childJobs";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

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

// ═══ TEST-45-01: valid shotId → persists videoUrl ═══
{
  const pid = await seedProject("T45-01");
  const sid = await seedShot(pid, "shot");
  const res = await resolveShotId(sid, pid);
  report("TEST-45-01 resolveShotId ok", res.ok === true);
  if (res.ok === true) {
    report("TEST-45-01 shotId resolved", res.shotId === sid);
    const pr = await persistVideoUrlToShot(sid, "/uploads/videos/t45_01.mp4");
    report("TEST-45-01 persist ok", pr.ok === true);
    const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
    report("TEST-45-01 videoUrl persisted", row.videoUrl === "/uploads/videos/t45_01.mp4");
  }
  await cleanupProject(pid);
}

// ═══ TEST-45-02: non-existent shotId → 404 ═══
{
  const pid = await seedProject("T45-02");
  const res = await resolveShotId(999999999, pid);
  report("TEST-45-02 non-existent shot rejected", res.ok === false);
  if (res.ok === false) {
    report("TEST-45-02 status is 404", res.status === 404, "status=" + res.status);
  }
  await cleanupProject(pid);
}

// ═══ TEST-45-03: shot from another project → 400 ═══
{
  const pidA = await seedProject("T45-03-A");
  const pidB = await seedProject("T45-03-B");
  const sidA = await seedShot(pidA, "belongs to A");
  const res = await resolveShotId(sidA, pidB);
  report("TEST-45-03 cross-project shot rejected", res.ok === false);
  if (res.ok === false) {
    report("TEST-45-03 status is 400", res.status === 400, "status=" + res.status);
  }
  await cleanupProject(pidA);
  await cleanupProject(pidB);
}

// ═══ TEST-45-04: missing shotId → backwards-compatible (no rejection) ═══
{
  const pid = await seedProject("T45-04");
  const res1 = await resolveShotId(undefined, pid);
  const res2 = await resolveShotId(null, pid);
  report("TEST-45-04 undefined shotId ok", res1.ok === true && (res1 as any).shotId === null);
  report("TEST-45-04 null shotId ok", res2.ok === true && (res2 as any).shotId === null);
  await cleanupProject(pid);
}

// ═══ TEST-45-05: DB failure → explicit error ═══
{
  const pid = await seedProject("T45-05");
  const sid = await seedShot(pid, "db-fail");
  // Use a shotId that resolves valid but with a deleted row: emulate by calling
  // persist on a shot that we delete right before.
  await db.delete(shotsTable).where(eq(shotsTable.id, sid));
  const pr = await persistVideoUrlToShot(sid, "/uploads/videos/t45_05.mp4");
  report("TEST-45-05 deleted shot → explicit failure", pr.ok === false);
  if (pr.ok === false) {
    report("TEST-45-05 status is 500", pr.status === 500, "status=" + pr.status);
  }
  await cleanupProject(pid);
}

// ═══ TEST-45-06: empty/invalid URL rejected ═══
{
  const pid = await seedProject("T45-06");
  const sid = await seedShot(pid, "empty");
  const r1 = await persistVideoUrlToShot(sid, "");
  const r2 = await persistVideoUrlToShot(sid, "   ");
  const r3 = await persistVideoUrlToShot(sid, 42 as any);
  report("TEST-45-06 empty string rejected", r1.ok === false);
  report("TEST-45-06 whitespace rejected", r2.ok === false);
  report("TEST-45-06 non-string rejected", r3.ok === false);
  const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
  report("TEST-45-06 shot.videoUrl remains null", row.videoUrl === null);
  await cleanupProject(pid);
}

// ═══ TEST-45-07: reuse of completed job doesn't create duplicates ═══
{
  const pid = await seedProject("T45-07");
  const sid = await seedShot(pid, "reuse");
  const runId = "t45-07-" + Date.now();
  const j1 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", sid, {
    projectId: pid, prompt: "x", shotId: sid, task: "i2v" as const,
    referenceImageBase64: "a".repeat(64),
  });
  const j2 = await getOrCreateChildJob("VIDEO_GEN", runId, "VIDEO_GEN", sid, {
    projectId: pid, prompt: "x", shotId: sid, task: "i2v" as const,
    referenceImageBase64: "a".repeat(64),
  });
  report("TEST-45-07 same job id reused", j1.id === j2.id);
  const rows = await db.select().from(productionPipeline)
    .where(and(eq(productionPipeline.parentRunId, runId), eq(productionPipeline.type, "VIDEO_GEN")));
  report("TEST-45-07 exactly 1 child job", rows.length === 1, "count=" + rows.length);
  await cleanupProject(pid);
}

// ═══ TEST-45-08: TASK-44 module still intact (no regression) ═══
{
  // Verify that shots.videoUrl is only written by our module, not accidentally
  // in multiple places. And verify the video.ts route uses our module.
  const src = fs.readFileSync("./src/routes/video.ts", "utf-8");
  const usesResolve = src.includes("resolveShotId(");
  const usesPersist = src.includes("persistVideoUrlToShot(");
  const noInlineUpdate = !/db\.update\(shotsTable\)/.test(src);
  report("TEST-45-08 video.ts uses resolveShotId", usesResolve);
  report("TEST-45-08 video.ts uses persistVideoUrlToShot", usesPersist);
  report("TEST-45-08 no inline db.update(shotsTable) in video.ts", noInlineUpdate);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
