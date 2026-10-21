/**
 * KAYAN-TASK-DEPLOY-07: behavioral test for entrypoint.sh.
 *
 * We do NOT run the real queue-worker/api. Instead we:
 *   1. Create a temp dir with a fake `node` shim that just appends its argv
 *      to a log file, then exits 0.
 *   2. Copy entrypoint.sh to the temp dir's expected relative paths
 *      (artifacts/api-server/dist/{index,queue-worker}.mjs as empty stubs).
 *   3. Run `sh entrypoint.sh` with PATH pointing at our fake node, once
 *      with NASHASH_DISABLE_AUTO_WORKER unset/0, once with =1.
 *   4. Assert on the log file: which "node" invocations actually happened.
 *
 * This proves real shell control flow (if/else/exec), not a regex match.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

const repoRoot = path.resolve(process.cwd(), "../..");
const entrypointSrc = path.join(repoRoot, "entrypoint.sh");
report("DEPLOY07-01 entrypoint.sh exists", fs.existsSync(entrypointSrc));

function runEntrypoint(disableValue: string | null): { log: string[]; exitCode: number | null } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ep-test-"));
  const binDir = path.join(tmp, "bin");
  const appDir = path.join(tmp, "app");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, "artifacts/api-server/dist"), { recursive: true });

  // Fake stubs for the files the entrypoint will try to `node ...`
  fs.writeFileSync(path.join(appDir, "artifacts/api-server/dist/index.mjs"), "");
  fs.writeFileSync(path.join(appDir, "artifacts/api-server/dist/queue-worker.mjs"), "");

  // Fake `node` shim: logs argv to NODE_LOG, exits 0
  const logFile = path.join(tmp, "node-calls.log");
  const shim = `#!/bin/sh\necho "$@" >> "${logFile}"\nexit 0\n`;
  fs.writeFileSync(path.join(binDir, "node"), shim, { mode: 0o755 });

  // Copy entrypoint
  const entrypointCopy = path.join(appDir, "entrypoint.sh");
  fs.copyFileSync(entrypointSrc, entrypointCopy);
  fs.chmodSync(entrypointCopy, 0o755);

  const env: NodeJS.ProcessEnv = {
    PATH: `${binDir}:${process.env.PATH || "/usr/bin:/bin"}`,
    // Default behavior when disable is null: unset
    ...(disableValue !== null ? { NASHASH_DISABLE_AUTO_WORKER: disableValue } : {}),
  };

  const result = spawnSync("sh", [entrypointCopy], {
    cwd: appDir,
    env,
    timeout: 10_000,
    encoding: "utf-8",
  });

  let log: string[] = [];
  if (fs.existsSync(logFile)) {
    log = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  return { log, exitCode: result.status };
}

// ── Scenario A: NASHASH_DISABLE_AUTO_WORKER=1 → ONLY index.mjs ──
{
  const { log, exitCode } = runEntrypoint("1");
  const combined = log.join("\n");
  report("DEPLOY07-02 (=1) exit code 0", exitCode === 0, `exitCode=${exitCode}`);
  report(
    "DEPLOY07-03 (=1) queue-worker.mjs NOT invoked",
    !combined.includes("queue-worker.mjs"),
    `log=${JSON.stringify(log)}`,
  );
  report(
    "DEPLOY07-04 (=1) index.mjs invoked",
    combined.includes("index.mjs"),
    `log=${JSON.stringify(log)}`,
  );
  report(
    "DEPLOY07-05 (=1) exactly one node invocation",
    log.length === 1,
    `count=${log.length}`,
  );
}

// ── Scenario B: NASHASH_DISABLE_AUTO_WORKER=0 → BOTH ────────────
{
  const { log, exitCode } = runEntrypoint("0");
  const combined = log.join("\n");
  report("DEPLOY07-06 (=0) exit code 0", exitCode === 0, `exitCode=${exitCode}`);
  report(
    "DEPLOY07-07 (=0) queue-worker.mjs invoked",
    combined.includes("queue-worker.mjs"),
    `log=${JSON.stringify(log)}`,
  );
  report(
    "DEPLOY07-08 (=0) index.mjs invoked",
    combined.includes("index.mjs"),
    `log=${JSON.stringify(log)}`,
  );
  report(
    "DEPLOY07-09 (=0) exactly two node invocations",
    log.length === 2,
    `count=${log.length}`,
  );
}

// ── Scenario C: unset → treated as 0 (default behavior) ─────────
{
  const { log, exitCode } = runEntrypoint(null);
  const combined = log.join("\n");
  report("DEPLOY07-10 (unset) exit code 0", exitCode === 0, `exitCode=${exitCode}`);
  report(
    "DEPLOY07-11 (unset) queue-worker.mjs invoked (default preserves old behavior)",
    combined.includes("queue-worker.mjs"),
    `log=${JSON.stringify(log)}`,
  );
  report(
    "DEPLOY07-12 (unset) index.mjs invoked",
    combined.includes("index.mjs"),
    `log=${JSON.stringify(log)}`,
  );
}

// ── Scenario D: entrypoint uses `exec` for API (proves no extra shell fork) ──
{
  const src = fs.readFileSync(entrypointSrc, "utf-8");
  report(
    "DEPLOY07-13 entrypoint uses exec for api-server",
    /exec\s+node\s+--enable-source-maps\s+artifacts\/api-server\/dist\/index\.mjs/.test(src),
  );
  // The "queue-worker" invocation MUST NOT be `exec` (would block API from starting)
  report(
    "DEPLOY07-14 queue-worker is backgrounded, not exec'd",
    /node\s+--enable-source-maps\s+artifacts\/api-server\/dist\/queue-worker\.mjs\s*&/.test(src),
  );
}

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
