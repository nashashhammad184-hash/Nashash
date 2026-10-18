import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { _resetStorageForTests } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Static checks on renderEngine
{
  const src = fs.readFileSync("./src/lib/renderEngine.ts", "utf-8");
  report("TASK-73F-01 imports resolveStorageUrlToLocal", /resolveStorageUrlToLocal/.test(src));
  report("TASK-73F-02 has storageCleanupTracker", /storageCleanupTracker/.test(src));
  report("TASK-73F-03 resolves /api/storage/r2/ URLs", /trimmed\.startsWith\("\/api\/storage\/r2\/"\)/.test(src));
  report("TASK-73F-04 /uploads/ has fallback", /file missing locally/.test(src));
  report("TASK-73F-05 success cleanup calls storage cleanup", /for \(const cl of storageCleanupTracker\)/.test(src));
  report("TASK-73F-06 passes tracker to audio resolve", /resolveAssetToLocal\(audioUrl, tempTracker, storageCleanupTracker\)/.test(src));
  report("TASK-73F-07 passes tracker to clip resolve", /resolveAssetToLocal\(c\.assetUrl, tempTracker, storageCleanupTracker\)/.test(src));
}

// Static checks on pipeline.ts for single-clip case
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  report("TASK-73F-08 pipeline uses resolved.path for concat", /perShotVoice\[sh\.id\]\?\.resolved\?\.path/.test(src));
  report("TASK-73F-09 pipeline has resolvedAudioTracker cleanup in finally", /resolvedAudioTracker[\s\S]{0,500}r\.cleanup\(\)/.test(src));
}

// Static checks on voice.ts
{
  const src = fs.readFileSync("./src/routes/voice.ts", "utf-8");
  report("TASK-73F-10 voice uses resolveStorageUrlToLocal", /resolveStorageUrlToLocal/.test(src));
  report("TASK-73F-11 voice calls cleanup in finally", /finally[\s\S]{0,200}cleanup\(\)/.test(src));
}

// Static checks on kayanGpuProvider
{
  const src = fs.readFileSync("./src/lib/kayanGpuProvider.ts", "utf-8");
  report("TASK-73F-12 kayanGpuProvider prefers remote_path", /r\.remote_path/.test(src));
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
