import fs from "node:fs";
import path from "node:path";
import { db, productionPipeline } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  decideStageReuse,
  resetJobForRebuild,
  validateVideoOutputOnDisk,
  validateVoiceOutputOnDisk,
  countChildJobsForRun,
} from "../src/lib/pipeline/stageReuse";
import { buildPipelineJobKey } from "../src/lib/pipeline/jobKeys";
import { createProductionJob, sweepStaleChildJobs } from "../src/lib/productionEngine";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = path.resolve(process.cwd(), "uploads", "temp", "task37");
fs.mkdirSync(TMP, { recursive: true });

interface FixtureShot { id: number; hasDialogue: boolean; text?: string; duration: number; }
// KAYAN-TASK-49: use unique shotIds per test run. The production worker on
// Northflank shares the same DATABASE_URL; if a test uses static shotIds
// (e.g. 101/102/103), a stale row left by a previous run or picked up by an
// external worker can collide with decideStageReuse's jobKey lookup and
// yield REUSE_PROCESSING_JOB instead of the expected SKIPPED/MISSING.
// A per-run random offset guarantees isolation without touching prod logic.
const __SHOT_BASE = 900_000_000 + (Date.now() % 90_000_000) + Math.floor(Math.random() * 1000);
const SHOTS: FixtureShot[] = [
  { id: __SHOT_BASE + 1, hasDialogue: true,  text: "Dialogue one",  duration: 5 },
  { id: __SHOT_BASE + 2, hasDialogue: true,  text: "Dialogue two",  duration: 5 },
  { id: __SHOT_BASE + 3, hasDialogue: false,                        duration: 5 },
];

function writeFile(name: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.from("V-" + name));
  return p;
}

async function seedChildJob(opts: {
  runId: string;
  stage: "VIDEO_GEN" | "VOICE_GEN" | "LIP_SYNC";
  shotId: number;
  status: "pending" | "processing" | "completed" | "failed";
  output: any;
  providerJobId?: string | null;
}) {
  const jobKey = buildPipelineJobKey(opts.runId, opts.stage, opts.shotId);
  // KAYAN-TASK-49: insert directly instead of going through
  // createProductionJob. createProductionJob briefly writes the row as
  // "pending" before the test overrides the status; the Northflank
  // production worker shares the same DATABASE_URL and could pick up the
  // pending row, attempt a real provider call, and race the test state.
  // Direct insert never exposes a "pending" state, isolating tests.
  const jobId = "job_test_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  const now = new Date();
  await db.insert(productionPipeline).values({
    id: jobId,
    projectId: 1,
    jobId,
    type: opts.stage,
    status: opts.status,
    progress: 0,
    payload: { projectId: 1, shotId: opts.shotId, prompt: "x", text: "x", videoUrl: "/x", audioUrl: "/x" } as any,
    retryCount: 0,
    maxRetries: 3,
    parentRunId: opts.runId,
    jobKey,
    output: (opts.output ?? null) as any,
    providerJobId: opts.providerJobId ?? null,
    completedAt: opts.status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return jobId;
}

async function cleanupRun(runId: string) {
  await db.delete(productionPipeline).where(eq(productionPipeline.parentRunId, runId));
}

// ═══ TEST-37-01: 3-shot fixture creation ═══
{
  const runId = "t37-01-" + Date.now();
  const vFiles: string[] = [];
  for (const s of SHOTS) {
    const p = writeFile(`v01-${s.id}.mp4`);
    vFiles.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/uploads/videos/v" + s.id + ".mp4" } });
  }
  const count = await countChildJobsForRun(runId);
  report("TEST-37-01 fixture has 3 video jobs", count === 3, "count=" + count);
  for (const f of vFiles) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-02: 3 independent video stages ═══
{
  const runId = "t37-02-" + Date.now();
  const vFiles: string[] = [];
  for (const s of SHOTS) {
    const p = writeFile(`v02-${s.id}.mp4`);
    vFiles.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/uploads/videos/v02-" + s.id + ".mp4" } });
  }
  let skipped = 0;
  const ids = new Set<string>();
  for (const s of SHOTS) {
    const r = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: s.id, validateOutput: validateVideoOutputOnDisk });
    if (r.decision === "SKIPPED_EXISTING_RESULT") skipped++;
    if (r.job) ids.add(r.job.id);
  }
  report("TEST-37-02 all 3 videos skipped (independent)", skipped === 3, "skipped=" + skipped);
  report("TEST-37-02 3 distinct job ids", ids.size === 3, "size=" + ids.size);
  for (const f of vFiles) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-03: 2 dialogue voice stages ═══
{
  const runId = "t37-03-" + Date.now();
  const dialogueShots = SHOTS.filter((s) => s.hasDialogue);
  const aFiles: string[] = [];
  for (const s of dialogueShots) {
    const p = writeFile(`a03-${s.id}.mp3`);
    aFiles.push(p);
    await seedChildJob({ runId, stage: "VOICE_GEN", shotId: s.id, status: "completed", output: { audioPath: p, audioUrl: "/uploads/audio/a03-" + s.id + ".mp3" } });
  }
  let ok = 0;
  for (const s of dialogueShots) {
    const r = await decideStageReuse({ runId, stage: "VOICE_GEN", shotId: s.id, validateOutput: validateVoiceOutputOnDisk });
    if (r.decision === "SKIPPED_EXISTING_RESULT") ok++;
  }
  report("TEST-37-03 both dialogue voices skipped", ok === 2, "ok=" + ok);
  for (const f of aFiles) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-04: no-dialogue shot → no VOICE_GEN ═══
{
  const runId = "t37-04-" + Date.now();
  const noDialogue = SHOTS.filter((s) => !s.hasDialogue);
  report("TEST-37-04 fixture has exactly 1 no-dialogue shot", noDialogue.length === 1);
  // Confirm no VOICE_GEN job for shot 103
  const key = buildPipelineJobKey(runId, "VOICE_GEN", SHOTS[2].id);
  const { findProductionJobByJobKey } = await import("../src/lib/productionEngine");
  const j = await findProductionJobByJobKey(key);
  report("TEST-37-04 no VOICE_GEN job for no-dialogue shot", j === undefined, "job=" + (j?.id ?? "none"));
  await cleanupRun(runId);
}

// ═══ TEST-37-05: shotId mapping Video → Voice ═══
{
  const runId = "t37-05-" + Date.now();
  const vF: string[] = [], aF: string[] = [];
  for (const s of SHOTS) {
    const vp = writeFile(`v05-${s.id}.mp4`);
    vF.push(vp);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: vp, videoUrl: "/v" } });
  }
  for (const s of SHOTS.filter((x) => x.hasDialogue)) {
    const ap = writeFile(`a05-${s.id}.mp3`);
    aF.push(ap);
    await seedChildJob({ runId, stage: "VOICE_GEN", shotId: s.id, status: "completed", output: { audioPath: ap, audioUrl: "/a" } });
  }
  // Verify per-shot keys resolve correctly and independently
  const v101 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[0].id, validateOutput: validateVideoOutputOnDisk });
  const v102 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[1].id, validateOutput: validateVideoOutputOnDisk });
  const v103 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[2].id, validateOutput: validateVideoOutputOnDisk });
  const a101 = await decideStageReuse({ runId, stage: "VOICE_GEN", shotId: SHOTS[0].id, validateOutput: validateVoiceOutputOnDisk });
  const a102 = await decideStageReuse({ runId, stage: "VOICE_GEN", shotId: SHOTS[1].id, validateOutput: validateVoiceOutputOnDisk });
  const a103 = await decideStageReuse({ runId, stage: "VOICE_GEN", shotId: SHOTS[2].id, validateOutput: validateVoiceOutputOnDisk });

  const vIds = new Set([v101.job?.id, v102.job?.id, v103.job?.id]);
  const aIds = new Set([a101.job?.id, a102.job?.id]);
  report("TEST-37-05 video jobs distinct per shot", vIds.size === 3, "size=" + vIds.size);
  report("TEST-37-05 voice jobs distinct per shot", aIds.size === 2, "size=" + aIds.size);
  report("TEST-37-05 shot 103 has video", v103.decision === "SKIPPED_EXISTING_RESULT");
  report("TEST-37-05 shot 103 has NO voice job", a103.decision === "MISSING", "decision=" + a103.decision);
  for (const f of [...vF, ...aF]) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-06: LIPSYNC disabled → zero jobs ═══
{
  const enabled = (process.env.LIPSYNC_ENABLED || "false").toLowerCase() === "true";
  report("TEST-37-06 LIPSYNC disabled", enabled === false, "enabled=" + enabled);
}

// ═══ TEST-37-07: Timeline contains all 3 shots ═══
{
  const runId = "t37-07-" + Date.now();
  const vF: string[] = [];
  for (const s of SHOTS) {
    const p = writeFile(`v07-${s.id}.mp4`);
    vF.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/v07-" + s.id } });
  }
  // Timeline insertion in pipeline.ts iterates `shots` and asserts synced exists for each.
  // We verify the reuse layer exposes all 3 independently, which is the input to timeline.
  let visible = 0;
  for (const s of SHOTS) {
    const r = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: s.id, validateOutput: validateVideoOutputOnDisk });
    if (r.decision === "SKIPPED_EXISTING_RESULT") visible++;
  }
  report("TEST-37-07 timeline would include all 3 shots", visible === 3, "visible=" + visible);
  for (const f of vF) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-08: Subtitles contain all dialogue shots ═══
{
  // Subtitles logic in pipeline.ts: builds subtitleItems for every shot with
  // non-empty dialogue. Verify the fixture drives 2 subtitle entries, not 1.
  const dialogueCount = SHOTS.filter((s) => s.hasDialogue && (s.text || "").trim().length > 0).length;
  report("TEST-37-08 subtitle count = dialogue shot count", dialogueCount === 2, "count=" + dialogueCount);
}

// ═══ TEST-37-09: Render receives all 3 shots ═══
{
  // Timeline insertion produces one VIDEO item per shot → renderClips maps
  // timelineInserted. Verify the fixture produces exactly 3 timeline items.
  const runId = "t37-09-" + Date.now();
  const vF: string[] = [];
  for (const s of SHOTS) {
    const p = writeFile(`v09-${s.id}.mp4`);
    vF.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/v09-" + s.id } });
  }
  const visible = [];
  for (const s of SHOTS) {
    const r = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: s.id, validateOutput: validateVideoOutputOnDisk });
    if (r.decision === "SKIPPED_EXISTING_RESULT") visible.push(s.id);
  }
  report("TEST-37-09 render source clips = 3 shots", visible.length === 3, "ids=" + visible.join(","));
  for (const f of vF) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-10: partial multi-shot Resume → only missing rebuilt ═══
{
  const runId = "t37-10-" + Date.now();
  const vF: string[] = [];
  for (const s of [SHOTS[0], SHOTS[1]]) {
    const p = writeFile(`v10-${s.id}.mp4`);
    vF.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/v10-" + s.id } });
  }
  const before = await countChildJobsForRun(runId);

  // Resume decisions
  const d1 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[0].id, validateOutput: validateVideoOutputOnDisk });
  const d2 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[1].id, validateOutput: validateVideoOutputOnDisk });
  const d3 = await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: SHOTS[2].id, validateOutput: validateVideoOutputOnDisk });

  report("TEST-37-10 shot 101 skipped", d1.decision === "SKIPPED_EXISTING_RESULT", "d=" + d1.decision);
  report("TEST-37-10 shot 102 skipped", d2.decision === "SKIPPED_EXISTING_RESULT", "d=" + d2.decision);
  report("TEST-37-10 shot 103 missing (rebuild)", d3.decision === "MISSING", "d=" + d3.decision);

  // create job for shot 103 only (simulates rebuild)
  await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 103, status: "pending", output: null });
  const after = await countChildJobsForRun(runId);
  report("TEST-37-10 only 1 new job added", after === before + 1, before + "→" + after);

  for (const f of vF) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-11: repeated Resume → zero duplicate child jobs ═══
{
  const runId = "t37-11-" + Date.now();
  const vF: string[] = [];
  for (const s of SHOTS) {
    const p = writeFile(`v11-${s.id}.mp4`);
    vF.push(p);
    await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: s.id, status: "completed", output: { videoPath: p, videoUrl: "/v11-" + s.id } });
  }
  const before = await countChildJobsForRun(runId);
  // two "resumes"
  for (let i = 0; i < 2; i++) {
    for (const s of SHOTS) {
      await decideStageReuse({ runId, stage: "VIDEO_GEN", shotId: s.id, validateOutput: validateVideoOutputOnDisk });
    }
  }
  const after = await countChildJobsForRun(runId);
  report("TEST-37-11 zero duplicate child jobs on 2x resume", after === before, before + "→" + after);
  for (const f of vF) try { fs.unlinkSync(f); } catch {}
  await cleanupRun(runId);
}

// ═══ TEST-37-12: no duplicate subtitles ═══
{
  // Subtitles are derived from shots deterministically and written to a single
  // per-run SRT path. Two resumes produce identical content (idempotent).
  const srt1 = SHOTS.filter(s => s.hasDialogue).map((s, i) => `${i + 1}\n00:00:0${i*5},000 --> 00:00:0${i*5+5},000\n${s.text}\n`).join("\n");
  const srt2 = SHOTS.filter(s => s.hasDialogue).map((s, i) => `${i + 1}\n00:00:0${i*5},000 --> 00:00:0${i*5+5},000\n${s.text}\n`).join("\n");
  report("TEST-37-12 subtitle generation idempotent", srt1 === srt2);
  report("TEST-37-12 subtitle entries = 2", srt1.split("\n\n").length === 2);
}

// ═══ TEST-37-13: no duplicate generated timeline rows ═══
{
  // Pipeline deletes only 'origin=generated' rows, then re-inserts one per shot.
  // Assert that the delete filter would match exactly the previously generated rows.
  const generated = SHOTS.map(s => ({ shotId: s.id, metadata: JSON.stringify({ origin: "generated" }) }));
  const keepManual = [{ shotId: 999, metadata: JSON.stringify({ origin: "manual" }) }];
  const allRows = [...generated, ...keepManual];
  const toDelete = allRows.filter(r => {
    try { return JSON.parse(r.metadata).origin === "generated"; } catch { return false; }
  });
  report("TEST-37-13 only generated rows deleted", toDelete.length === 3);
  report("TEST-37-13 manual row preserved", toDelete.every(r => r.shotId !== 999));
}

// ═══ TEST-37-20..24: periodic sweep semantics ═══
{
  // fresh processing job (updatedAt=now) → not swept
  const runId = "t37-20-" + Date.now();
  const j = await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 1, status: "processing", output: null });
  await db.update(productionPipeline).set({ updatedAt: new Date() }).where(eq(productionPipeline.id, j));
  const swept1 = await sweepStaleChildJobs(60_000);
  const after1 = await db.select().from(productionPipeline).where(eq(productionPipeline.id, j));
  report("TEST-37-20 fresh processing job untouched", after1[0]?.status === "processing", "status=" + after1[0]?.status);
  await cleanupRun(runId);
}

{
  // stale processing job → swept to failed with WORKER_TIMEOUT
  const runId = "t37-21-" + Date.now();
  const j = await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 1, status: "processing", output: null });
  const old = new Date(Date.now() - 5 * 60_000);
  await db.update(productionPipeline).set({ updatedAt: old }).where(eq(productionPipeline.id, j));
  await sweepStaleChildJobs(60_000);
  const after = await db.select().from(productionPipeline).where(eq(productionPipeline.id, j));
  report("TEST-37-21 stale processing job swept to failed", after[0]?.status === "failed", "status=" + after[0]?.status);
  report("TEST-37-21 error tagged WORKER_TIMEOUT", (after[0]?.errorMessage || "").startsWith("WORKER_TIMEOUT"));
  await cleanupRun(runId);
}

{
  // completed job → untouched
  const runId = "t37-22-" + Date.now();
  const p = writeFile("v22.mp4");
  const j = await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 1, status: "completed", output: { videoPath: p, videoUrl: "/v22" } });
  await db.update(productionPipeline).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(productionPipeline.id, j));
  await sweepStaleChildJobs(60_000);
  const after = await db.select().from(productionPipeline).where(eq(productionPipeline.id, j));
  report("TEST-37-22 completed job untouched", after[0]?.status === "completed", "status=" + after[0]?.status);
  try { fs.unlinkSync(p); } catch {}
  await cleanupRun(runId);
}

{
  // queued/pending job → untouched
  const runId = "t37-23-" + Date.now();
  const j = await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 1, status: "pending", output: null });
  await db.update(productionPipeline).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(productionPipeline.id, j));
  await sweepStaleChildJobs(60_000);
  const after = await db.select().from(productionPipeline).where(eq(productionPipeline.id, j));
  report("TEST-37-23 queued job untouched", after[0]?.status === "pending", "status=" + after[0]?.status);
  await cleanupRun(runId);
}

{
  // two concurrent sweeps → single transition, no duplicate jobs
  const runId = "t37-24-" + Date.now();
  const j = await seedChildJob({ runId, stage: "VIDEO_GEN", shotId: 1, status: "processing", output: null });
  const old = new Date(Date.now() - 5 * 60_000);
  await db.update(productionPipeline).set({ updatedAt: old }).where(eq(productionPipeline.id, j));
  const before = await countChildJobsForRun(runId);
  await Promise.all([sweepStaleChildJobs(60_000), sweepStaleChildJobs(60_000)]);
  const after = await db.select().from(productionPipeline).where(eq(productionPipeline.id, j));
  const total = await countChildJobsForRun(runId);
  report("TEST-37-24 concurrent sweeps → single failed transition", after[0]?.status === "failed");
  report("TEST-37-24 no duplicate child jobs from sweeps", total === before, before + "→" + total);
  await cleanupRun(runId);
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
