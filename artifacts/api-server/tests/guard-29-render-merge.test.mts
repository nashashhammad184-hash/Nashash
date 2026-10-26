/**
 * KAYAN-GUARD-29: isolated behavioral tests for renderMerge.executeMerge.
 * No HTTP, no DB, no storage. All deps injected.
 */
import { executeMerge, parseTimelineSubsToSRT } from "../src/routes/renderMerge";
import { _setRenderDeps, createRenderJob } from "../src/lib/renderEngine";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Fake DB for renderEngine's createRenderJob
const jobStore = new Map<string, any>();
let lastId: string | null = null;
const fakeDb: any = {
  insert: () => ({ values: (v: any) => ({ returning: async () => {
    const id = "fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const row = { id, status: "QUEUED", ...v, createdAt: new Date() };
    jobStore.set(id, row); lastId = id; return [row];
  }})}),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => lastId ? [jobStore.get(lastId)] : [] }) }) }),
  update: () => ({ set: (p: any) => ({ where: async () => { for (const [k,r] of jobStore) jobStore.set(k,{...r,...p}); } }) }),
};
_setRenderDeps({ getDb: () => fakeDb });

// ─── SRT parsing (pure) ───────────────────────────────────────────────
report("P1 empty subs → undefined", parseTimelineSubsToSRT([]) === undefined);
report("P2 null subs → undefined", parseTimelineSubsToSRT(null) === undefined);
const srt = parseTimelineSubsToSRT([
  { index: 1, start: "00:00:00,000", end: "00:00:02,500", text: "first" },
  { index: 2, start: "00:00:03,000", end: "00:00:05,000", text: "second" },
]);
report("P3 valid subs → SRT string", typeof srt === "string" && srt.includes("first") && srt.includes("second"), srt?.slice(0, 40));
report("P4 SRT has 2 sequence blocks", (srt?.match(/-->/g) || []).length === 2);
// invalid timings
const srt2 = parseTimelineSubsToSRT([
  { start: "bad", end: "00:00:02,000", text: "x" },
  { start: "00:00:02,000", end: "00:00:01,000", text: "y" }, // end<start
  { start: "00:00:00,000", end: "00:00:01,000", text: "ok" },
]);
report("P5 invalid rows skipped, valid kept", (srt2?.match(/-->/g) || []).length === 1, srt2);

// ─── executeMerge — validation ────────────────────────────────────────
function makeDeps(shots: Array<{ videoUrl: string | null }>, opts: { failCreate?: boolean } = {}): any {
  return {
    getShots: async () => shots,
    createJob: opts.failCreate ? (async () => { throw new Error("TEST-CREATE-FAIL"); }) : createRenderJob,
    scheduleRender: () => {},
  };
}

{
  const r = await executeMerge(null as any, makeDeps([]));
  report("E1 null body → 400 INVALID_BODY", r.ok === false && r.status === 400 && r.error === "INVALID_BODY");
  const r2 = await executeMerge({} as any, makeDeps([]));
  report("E1b {} body → 400 INVALID_PROJECT_ID", r2.ok === false && r2.status === 400 && r2.error === "INVALID_PROJECT_ID");
}
{
  const r = await executeMerge({ projectId: 0, clips: [] } as any, makeDeps([]));
  report("E2 projectId=0 → 400 INVALID_PROJECT_ID", r.ok === false && r.error === "INVALID_PROJECT_ID");
}
{
  const r = await executeMerge({ projectId: 1, clips: [] } as any, makeDeps([]));
  report("E3 empty clips → 400 EMPTY_CLIPS", r.ok === false && r.error === "EMPTY_CLIPS");
}
{
  const r = await executeMerge({ projectId: 1, clips: [{ assetUrl: "" }] } as any, makeDeps([]));
  report("E4 clip without assetUrl → 400 INVALID_CLIP", r.ok === false && r.error === "INVALID_CLIP");
}
{
  const r = await executeMerge(
    { projectId: 1, clips: [{ id: "c1", assetUrl: "https://attacker/x.mp4", durationSeconds: 5, order: 0 }] } as any,
    makeDeps([{ videoUrl: "https://legit/shot1.mp4" }]),
  );
  report("E5 foreign clip → 403 CLIP_NOT_IN_PROJECT", r.ok === false && r.status === 403 && r.error === "CLIP_NOT_IN_PROJECT");
}
{
  // getShots throws
  const deps = { getShots: async () => { throw new Error("DB-DOWN"); }, createJob: async () => ({}), scheduleRender: () => {} };
  const r = await executeMerge({ projectId: 1, clips: [{ id: "c", assetUrl: "x", durationSeconds: 5, order: 0 }] } as any, deps as any);
  report("E6 shots query fails → 500 SHOTS_QUERY_FAILED", r.ok === false && r.status === 500 && r.error === "SHOTS_QUERY_FAILED");
}
{
  // createJob throws
  const r = await executeMerge(
    { projectId: 1, clips: [{ id: "c1", assetUrl: "https://ok/x.mp4", durationSeconds: 5, order: 0 }] } as any,
    makeDeps([{ videoUrl: "https://ok/x.mp4" }], { failCreate: true }),
  );
  report("E7 createJob fails → 500 CREATE_JOB_FAILED", r.ok === false && r.status === 500 && r.error === "CREATE_JOB_FAILED");
}

// ─── executeMerge — happy path ────────────────────────────────────────
{
  let scheduleCalls = 0;
  const r = await executeMerge(
    {
      projectId: 7,
      clips: [
        { id: "a", assetUrl: "https://ok/a.mp4", durationSeconds: 2, order: 0 },
        { id: "b", assetUrl: "https://ok/b.mp4", durationSeconds: 2, order: 1 },
      ],
      timelineSubs: [{ index: 1, start: "00:00:00,000", end: "00:00:04,000", text: "hello" }],
    } as any,
    {
      getShots: async () => [{ videoUrl: "https://ok/a.mp4" }, { videoUrl: "https://ok/b.mp4" }],
      createJob: createRenderJob,
      scheduleRender: () => { scheduleCalls++; },
    },
  );
  report("E8 happy path → ok:true", r.ok === true, JSON.stringify(r));
  report("E9 jobId present", r.ok === true && typeof (r as any).jobId === "string");
  report("E10 scheduleRender called once", scheduleCalls === 1);
  if (r.ok) {
    const row = jobStore.get(r.jobId);
    report("E11 subtitlesText persisted", row?.input?.subtitlesText?.includes("hello"));
    report("E12 clips persisted", Array.isArray(row?.input?.clips) && row.input.clips.length === 2);
    report("E13 status QUEUED", row?.status === "QUEUED");
  }
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
