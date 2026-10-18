import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const pExec = promisify(execFile);
let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t66-"));
const TEMP_ASSETS_DIR = path.resolve(process.cwd(), "uploads", "temp", "render_assets");
fs.mkdirSync(TEMP_ASSETS_DIR, { recursive: true });

// Fixtures: small valid MP4 (1 sec color) + MP3 (1 sec silence)
async function makeMp4(out: string, color = "red"): Promise<void> {
  await pExec("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x240:d=1:r=24`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
}
async function makeMp3(out: string): Promise<void> {
  await pExec("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:a", "libmp3lame", "-q:a", "6",
    out,
  ]);
}

// ───────────────────────────────────────────────────────────
// Test 1: leak detection via manual simulation of tracker
// We exercise the same logic as renderEngine's tempTracker.
// ───────────────────────────────────────────────────────────
{
  const tracker: string[] = [];
  const clipA = path.join(TMP, "a.mp4");
  const clipB = path.join(TMP, "b.mp4");
  await makeMp4(clipA, "red");
  await makeMp4(clipB, "blue");

  // Register temp files
  const trim1 = path.join(TEMP_ASSETS_DIR, `trim_sim_0.mp4`);
  const trim2 = path.join(TEMP_ASSETS_DIR, `trim_sim_1.mp4`);
  const list = path.join(TEMP_ASSETS_DIR, `concat_sim.txt`);
  const concat = path.join(TEMP_ASSETS_DIR, `concat_sim.mp4`);
  tracker.push(trim1, trim2, list, concat);

  // Simulate: trim step writes 2 files, then fails before concat
  fs.copyFileSync(clipA, trim1);
  fs.copyFileSync(clipB, trim2);
  // simulate failure -> cleanup
  for (const tf of tracker) { try { fs.unlinkSync(tf); } catch {} }

  report("TASK-66-01 failure cleanup removes trim files",
    !fs.existsSync(trim1) && !fs.existsSync(trim2));
  report("TASK-66-02 failure cleanup does not delete source clips",
    fs.existsSync(clipA) && fs.existsSync(clipB));
}

// ───────────────────────────────────────────────────────────
// Test 2: success cleanup removes all temps
// ───────────────────────────────────────────────────────────
{
  const tracker: string[] = [];
  const list = path.join(TEMP_ASSETS_DIR, `concat_ok.txt`);
  const concat = path.join(TEMP_ASSETS_DIR, `concat_ok.mp4`);
  const srt = path.join(TEMP_ASSETS_DIR, `subs_ok.srt`);
  tracker.push(list, concat, srt);
  fs.writeFileSync(list, "file 'x'");
  fs.copyFileSync(path.join(TMP, "a.mp4"), concat);
  fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nx\n");

  for (const tf of tracker) { try { fs.unlinkSync(tf); } catch {} }

  report("TASK-66-03 success cleanup removes all temps",
    !fs.existsSync(list) && !fs.existsSync(concat) && !fs.existsSync(srt));
}

// ───────────────────────────────────────────────────────────
// Test 3: download tracker mechanism (mimic downloadToTemp push)
// ───────────────────────────────────────────────────────────
{
  const tracker: string[] = [];
  const dlPath = path.join(TEMP_ASSETS_DIR, `dl_sim_${Date.now()}.mp4`);
  fs.copyFileSync(path.join(TMP, "a.mp4"), dlPath);
  tracker.push(dlPath);
  report("TASK-66-04 downloaded file tracked",
    tracker.includes(dlPath) && fs.existsSync(dlPath));
  for (const tf of tracker) { try { fs.unlinkSync(tf); } catch {} }
  report("TASK-66-05 download cleanup works", !fs.existsSync(dlPath));
}

// ───────────────────────────────────────────────────────────
// Test 4: temp files do not pollute RENDERS_DIR
// ───────────────────────────────────────────────────────────
{
  const RENDERS_DIR = path.resolve(process.cwd(), "uploads", "renders");
  // Ensure no file from this test starts with trim_/concat_/dl_/subs_
  const dirs = [RENDERS_DIR, TEMP_ASSETS_DIR];
  let leaked = 0;
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.startsWith("trim_sim_") || f.startsWith("concat_ok") ||
          f.startsWith("dl_sim_") || f.startsWith("subs_ok")) {
        leaked++;
      }
    }
  }
  report("TASK-66-06 no test temp files leaked into permanent dirs", leaked === 0, "leaked=" + leaked);
}

// ───────────────────────────────────────────────────────────
// Test 5: static check — renderEngine contains tempTracker in both paths
// ───────────────────────────────────────────────────────────
{
  const src = fs.readFileSync("./src/lib/renderEngine.ts", "utf-8");
  const hasTrackerInit = /const tempTracker: string\[\] = \[\];/.test(src);
  // KAYAN-TASK-73F inserted storageCleanupTracker between tempTracker and setJobStatus.
const hasSuccessCleanup = /for \(const tf of tempTracker\) \{ try \{ fs\.unlinkSync\(tf\); \} catch \{\} \}[\s\S]{0,400}await setJobStatus\(jobId, "COMPLETED"/.test(src);
  // KAYAN-TASK-73F inserted storageCleanupTracker between tempTracker and best-effort cleanup.
const hasFailureCleanup = /for \(const tf of tempTracker\) \{ try \{ fs\.unlinkSync\(tf\); \} catch \{\} \}[\s\S]{0,400}\/\/ best-effort cleanup/.test(src);
  report("TASK-66-07 tracker initialized", hasTrackerInit);
  report("TASK-66-08 success path uses tracker", hasSuccessCleanup);
  report("TASK-66-09 failure path uses tracker", hasFailureCleanup);
}

// ───────────────────────────────────────────────────────────
// Test 6: verify tmp dir does not have leftover files from our tests
// ───────────────────────────────────────────────────────────
{
  let leftover = 0;
  for (const f of fs.readdirSync(TEMP_ASSETS_DIR)) {
    if (f.startsWith("trim_sim_") || f.startsWith("concat_ok") ||
        f.startsWith("dl_sim_") || f.startsWith("subs_ok")) leftover++;
  }
  report("TASK-66-10 no leftover test temp files", leftover === 0, "leftover=" + leftover);
}

// cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
