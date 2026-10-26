/**
 * KAYAN-GUARD-30: E2E MP4 production.
 * Clips → renderEngine → real MP4 file on disk → ffprobe verification.
 * No DB, no network, no external services.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRenderJob, runRenderPipeline, getRenderJobStatus, _setRenderDeps } from "../src/lib/renderEngine";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Fake DB (same as guard-27)
const store = new Map<string, any>();
let lastId: string | null = null;
const fakeDb: any = {
  insert: () => ({ values: (v: any) => ({ returning: async () => {
    const id = "e2e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const row = { id, status: "QUEUED", ...v, createdAt: new Date() };
    store.set(id, row); lastId = id; return [row];
  }})}),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => lastId ? [store.get(lastId)] : [] }) }) }),
  update: () => ({ set: (p: any) => ({ where: async () => { for (const [k,r] of store) store.set(k,{...r,...p}); } }) }),
};
_setRenderDeps({
  getDb: () => fakeDb,
  resolveLocal: async () => { throw new Error("no"); },
  persist: async (lp: string) => ({ url: "fake://" + path.basename(lp), sizeBytes: 1, key: "k", basename: path.basename(lp) }),
});

const FIX = fs.mkdtempSync(path.join(os.tmpdir(), "e2e30-"));
const clipA = path.join(FIX, "a.mp4");
const clipB = path.join(FIX, "b.mp4");
const voice = path.join(FIX, "v.m4a");
const RENDERS = path.resolve(process.cwd(), "uploads", "renders");
fs.mkdirSync(RENDERS, { recursive: true });
const OUT = path.join(RENDERS, "e2e-g30-final.mp4");

function run() {
  execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=red:s=320x240:d=2:r=24","-pix_fmt","yuv420p","-c:v","libx264","-t","2", clipA]);
  execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=320x240:d=2:r=24","-pix_fmt","yuv420p","-c:v","libx264","-t","2", clipB]);
  execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","sine=f=440:d=4","-c:a","aac", voice]);
}

async function main() {
  run();
  const job = await createRenderJob({
    projectId: 42,
    clips: [
      { id: "a", assetUrl: clipA, durationSeconds: 2, order: 0 },
      { id: "b", assetUrl: clipB, durationSeconds: 2, order: 1 },
    ],
    audioUrl: voice,
    subtitlesText: "1\n00:00:00,000 --> 00:00:01,500\nFirst line\n\n2\n00:00:02,000 --> 00:00:03,500\nSecond line\n",
  });
  await runRenderPipeline(job.id);
  const st = await getRenderJobStatus(job.id);
  report("E2E-01 render COMPLETED", st?.status === "COMPLETED", st?.error || "ok");
  report("E2E-02 outputPath on disk", typeof st?.outputPath === "string" && fs.existsSync(st.outputPath));
  if (st?.outputPath) {
    fs.copyFileSync(st.outputPath, OUT);
    report("E2E-03 copied to stable path", fs.existsSync(OUT));
  }
}

await main();

if (fs.existsSync(OUT)) {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_entries","format=duration,size,bit_rate:stream=codec_type,codec_name,width,height", "-of","json", OUT]).toString());
  const streams = probe.streams || [];
  const video = streams.find((s: any) => s.codec_type === "video");
  const audio = streams.find((s: any) => s.codec_type === "audio");
  const dur = Number(probe.format?.duration ?? 0);
  const size = Number(probe.format?.size ?? 0);

  report("E2E-04 has video stream", !!video, video?.codec_name);
  report("E2E-05 has audio stream", !!audio, audio?.codec_name);
  report("E2E-06 duration ~4s (2+2)", dur >= 3.5 && dur <= 4.5, dur + "s");
  report("E2E-07 size > 10KB", size > 10240, size + " bytes");
  console.log("PRODUCED_MP4=" + OUT);
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
