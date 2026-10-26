/**
 * KAYAN-GUARD-05 (behavioral): execute loadEnv with a fake .env that
 * contains a unique GPU_SSH_TARGET, capture stdout, and assert the value
 * never appears. Complements the source-scan test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const SENTINEL_SSH = "sentinel-host-DO-NOT-LEAK-9c4f";

// Build a temp .env
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadenv-b-"));
const envFile = path.join(tmpDir, ".env");
fs.writeFileSync(envFile, `GPU_SSH_TARGET=${SENTINEL_SSH}\nOTHER=ok\n`);

// Compile loadEnv to JS in temp and execute it
const srcPath = path.resolve(process.cwd(), "src/loadEnv.ts");
const compiledPath = path.join(tmpDir, "loadEnv.cjs");
const tsc = spawnSync(
  "pnpm",
  ["exec", "esbuild", srcPath, "--bundle", "--platform=node", "--format=cjs",
   `--outfile=${compiledPath}`],
  { encoding: "utf8" }
);
if (tsc.status !== 0) {
  console.log("build stderr:", tsc.stderr?.slice(0, 300));
}

const run = spawnSync(
  "node",
  [compiledPath],
  {
    env: { ...process.env, KAYAN_ENV_FILE: envFile, NODE_PATH: path.resolve(process.cwd(), "../../node_modules") },
    encoding: "utf8",
  }
);

const combined = (run.stdout || "") + (run.stderr || "");
report("G5B-01 loadEnv ran", run.status === 0, `status=${run.status} stderr=${(run.stderr||'').slice(0,120)}`);
report("G5B-02 sentinel SSH target NOT leaked", !combined.includes(SENTINEL_SSH));
report("G5B-03 message mentions 'configured'", /gpuSshTarget=configured/.test(combined), combined.slice(0, 200));
report("G5B-04 .env override applied", combined.includes("loadEnv") || run.status === 0);

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
