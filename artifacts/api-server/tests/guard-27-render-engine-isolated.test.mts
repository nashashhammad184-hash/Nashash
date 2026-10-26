/**
 * KAYAN-GUARD-27: isolated behavioral tests for renderEngine with DI.
 * No DB, no network, no Supabase/Aiven. Uses fake DB + fake persist.
 * Fixtures generated locally via ffmpeg. Output goes to process.cwd()/uploads/renders.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  createRenderJob,
  runRenderPipeline,
  getRenderJobStatus,
  _setRenderDeps,
  _resetRenderDeps,
} from "../src/lib/renderEngine";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── Fake DB ───────────────────────────────────────────────────
const store = new Map<string, any>();
let _lastInsertedId: string | null = null;
const fakeDb: any = {
  // KAYAN-GUARD-27: returns the LAST inserted row (matches test pattern of
  // create → immediately check). This avoids duplicating drizzle where-clause
  // parsing in the fake.
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          if (!_lastInsertedId) return [];
          const r = store.get(_lastInsertedId);
          return r ? [r] : [];
        },
      }),
    }),
  }),
  insert: () => ({
    values: (v: any) => ({
      returning: async () => {
        const id = v.id ?? ("fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
        const row = { id, ...v, createdAt: new Date() };
        store.set(id, row);
        _lastInsertedId = id;
        return [row];
      },
    }),
  }),
  update: () => ({
    set: (patch: any) => ({
      where: async () => {
        for (const [k, r] of store) store.set(k, { ...r, ...patch });
      },
    }),
  }),
};

// ─── Fake persist (no storage layer) ────────────────────────────
let persistCalls = 0;
let persistShouldFail = false;
const fakePersist = async (localPath: string) => {
  persistCalls++;
  if (persistShouldFail) throw new Error("TEST-PERSIST-FAIL");
  return { key: "test", url: `fake://renders/${path.basename(localPath)}`, sizeBytes: 1, basename: path.basename(localPath) };
};

// ─── Fake resolveLocal (must never be called — clips are absolute paths) ───
let resolveCalls = 0;
const fakeResolve = async (_u: string) => {
  resolveCalls++;
  throw new Error("TEST: resolveLocal should not be called for absolute paths");
};

_setRenderDeps({ getDb: () => fakeDb, persist: fakePersist, resolveLocal: fakeResolve });

// ─── Fixtures ──────────────────────────────────────────────────
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), "guard-27-fix-"));
const clipA = path.join(FIX, "clip-a.mp4");
const clipB = path.join(FIX, "clip-b.mp4");
const voiceM4a = path.join(FIX, "voice.m4a");
const corruptMp4 = path.join(FIX, "corrupt.mp4");

function makeClip(p: string, color: string, dur: number) {
  execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error",
    "-f","lavfi","-i",`color=c=${color}:s=320x240:d=${dur}:r=24`,
    "-pix_fmt","yuv420p","-c:v","libx264","-t",String(dur), p]);
}
function makeAudio(p: string, dur: number) {
  execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error",
    "-f","lavfi","-i",`sine=f=440:d=${dur}`, "-c:a","aac", p]);
}

makeClip(clipA, "red", 2);
makeClip(clipB, "blue", 2);
makeAudio(voiceM4a, 4);
fs.writeFileSync(corruptMp4, Buffer.from("not a real mp4 file"));

const RENDERS_DIR = path.resolve(process.cwd(), "uploads", "renders");
fs.mkdirSync(RENDERS_DIR, { recursive: true });

function cleanupRenders() {
  if (!fs.existsSync(RENDERS_DIR)) return;
  for (const f of fs.readdirSync(RENDERS_DIR)) {
    if (f.startsWith("render_fake_")) {
      try { fs.unlinkSync(path.join(RENDERS_DIR, f)); } catch {}
    }
  }
}

// ═══ T1: happy path (2 clips + audio) ═══
{
  const job = await createRenderJob({
    projectId: 1,
    clips: [
      { id: "a", assetUrl: clipA, durationSeconds: 2, order: 0 },
      { id: "b", assetUrl: clipB, durationSeconds: 2, order: 1 },
    ],
    audioUrl: voiceM4a,
  });
  await runRenderPipeline(job.id);
  const st = await getRenderJobStatus(job.id);
  report("T1 status=COMPLETED", st?.status === "COMPLETED", `status=${st?.status} err=${st?.error}`);
  report("T1 outputUrl set", typeof st?.outputUrl === "string" && st.outputUrl.startsWith("fake://"));
  report("T1 duration ~4s", typeof st?.duration === "number" && st.duration >= 3.5 && st.duration <= 4.5, `dur=${st?.duration}`);
  report("T1 persist called once", persistCalls === 1, `calls=${persistCalls}`);
}

// ═══ T2: missing clip file → FAILED ═══
{
  const missing = path.join(FIX, "does-not-exist.mp4");
  const job = await createRenderJob({
    projectId: 1,
    clips: [{ id: "x", assetUrl: missing, durationSeconds: 2, order: 0 }],
  });
  await runRenderPipeline(job.id);
  const st = await getRenderJobStatus(job.id);
  report("T2 missing clip → FAILED", st?.status === "FAILED", `status=${st?.status}`);
  report("T2 error mentions file", typeof st?.error === "string" && /not found|file/.test(st.error), st?.error?.slice(0, 80));
}

// ═══ T3: corrupt clip (ffmpeg fails) → FAILED ═══
{
  const job = await createRenderJob({
    projectId: 1,
    clips: [{ id: "c", assetUrl: corruptMp4, durationSeconds: 2, order: 0 }],
  });
  await runRenderPipeline(job.id);
  const st = await getRenderJobStatus(job.id);
  report("T3 corrupt clip → FAILED", st?.status === "FAILED", `status=${st?.status}`);
}

// ═══ T4: persist failure → FAILED ═══
{
  persistShouldFail = true;
  const before = persistCalls;
  const job = await createRenderJob({
    projectId: 1,
    clips: [{ id: "a", assetUrl: clipA, durationSeconds: 2, order: 0 }],
  });
  await runRenderPipeline(job.id);
  persistShouldFail = false;
  const st = await getRenderJobStatus(job.id);
  report("T4 persist fail → FAILED", st?.status === "FAILED", `status=${st?.status}`);
  report("T4 error mentions storage", typeof st?.error === "string" && /storage|persist/i.test(st.error), st?.error?.slice(0, 100));
  report("T4 persist called after failure", persistCalls > before);
}

// ═══ T5: no resolveLocal calls (absolute paths only) ═══
report("T5 resolveLocal never called", resolveCalls === 0, `calls=${resolveCalls}`);

// ═══ T6: temp cleanup after success & failure ═══
{
  const TEMP = path.resolve(process.cwd(), "uploads", "temp", "render_assets");
  const before = fs.existsSync(TEMP) ? fs.readdirSync(TEMP).filter(f => f.startsWith("concat_fake_")).length : 0;
  // Success case
  const job = await createRenderJob({ projectId: 1, clips: [{ id: "a", assetUrl: clipA, durationSeconds: 2, order: 0 }] });
  await runRenderPipeline(job.id);
  // Failure case
  const job2 = await createRenderJob({ projectId: 1, clips: [{ id: "c", assetUrl: corruptMp4, durationSeconds: 2, order: 0 }] });
  await runRenderPipeline(job2.id);
  const after = fs.existsSync(TEMP) ? fs.readdirSync(TEMP).filter(f => f.startsWith("concat_fake_")).length : 0;
  report("T6 no new concat_ temp files remain", after === before, `before=${before} after=${after}`);
}

// ═══ T7: idempotency — re-running COMPLETED is a no-op ═══
{
  const job = await createRenderJob({ projectId: 1, clips: [{ id: "a", assetUrl: clipA, durationSeconds: 2, order: 0 }] });
  await runRenderPipeline(job.id);
  const before = persistCalls;
  await runRenderPipeline(job.id); // already COMPLETED
  const after = persistCalls;
  report("T7 second run does not persist again", before === after, `before=${before} after=${after}`);
}

// ─── Cleanup ───────────────────────────────────────────────────
cleanupRenders();
try { fs.rmSync(FIX, { recursive: true, force: true }); } catch {}
_resetRenderDeps();

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
