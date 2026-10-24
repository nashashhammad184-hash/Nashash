/**
 * KAYAN-CINEMA-03D: recovery & paid-request prevention tests.
 * No real WaveSpeed, no DB. Uses mock provider + static source checks.
 */
import { classifyRetry } from "../src/lib/productionEngine.ts";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

// ── 1. classifyRetry — the decision engine ───────────────────────
// SUBMIT_UNCERTAIN explicit
check("classify: submit_uncertain explicit",
  classifyRetry("SUBMIT_UNCERTAIN: accepted but persist failed", { type: "VIDEO_GEN" }) === "SUBMIT_UNCERTAIN");

// providerJobId set → RETRY_LIMITED (resume, not new submit)
check("classify: providerJobId set → RETRY_LIMITED",
  classifyRetry("some error", { providerJobId: "id::url", type: "VIDEO_GEN" }) === "RETRY_LIMITED");

// Uncertain patterns (no providerJobId) → SUBMIT_UNCERTAIN
const uncertainTests = [
  "timeout expired",
  "request AbortError",
  "ECONNRESET",
  "fetch failed",
  "socket hang up",
  "HTTP 500 from submit",
  "HTTP 502",
  "HTTP 503",
  "HTTP 504",
];
for (const msg of uncertainTests) {
  check(`classify: "${msg}" → SUBMIT_UNCERTAIN`,
    classifyRetry(msg, { type: "VIDEO_GEN" }) === "SUBMIT_UNCERTAIN");
}

// Pre-submit failures → NO_RETRY
const noRetryTests = [
  "HTTP 400 invalid body",
  "HTTP 401 unauthorized",
  "HTTP 403 forbidden",
  "HTTP 402 billing required",
  "invalid duration value",
  "requires reference image",
  "validation failed",
];
for (const msg of noRetryTests) {
  check(`classify: "${msg}" → NO_RETRY`,
    classifyRetry(msg, { type: "VIDEO_GEN" }) === "NO_RETRY");
}

// 429 rate limit (pre-submit, no providerJobId) → RETRY_LIMITED
check("classify: HTTP 429 → RETRY_LIMITED",
  classifyRetry("HTTP 429 rate limit", { type: "VIDEO_GEN" }) === "RETRY_LIMITED");

// Generic error → RETRY_LIMITED (safe default)
check("classify: unknown error → RETRY_LIMITED",
  classifyRetry("something odd happened", { type: "VIDEO_GEN" }) === "RETRY_LIMITED");

// ── 2. Structural checks on productionEngine.ts ─────────────────
const engineSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/productionEngine.ts"), "utf-8");

check("engine: passes onSubmitted to runExternalVideoJob",
  /onSubmitted:\s*async\s*\(\s*qid\s*:\s*string\s*\)\s*=>/.test(engineSrc));

check("engine: passes resumeProviderJobId",
  /resumeProviderJobId:\s*job\.providerJobId/.test(engineSrc));

check("engine: catch block handles SUBMIT_UNCERTAIN",
  /if\s*\(\s*decision\s*===\s*['"]SUBMIT_UNCERTAIN['"]\s*\)/.test(engineSrc));

check("engine: boot recovery has SUBMIT_UNCERTAIN case",
  /SUBMIT_UNCERTAIN \(recovery\)/.test(engineSrc));

check("engine: boot recovery distinguishes providerJobId",
  /hasProviderJobId/.test(engineSrc));

check("engine: boot recovery resumes poll when providerJobId set",
  /will resume poll with existing providerJobId/.test(engineSrc));

// ── 3. Structural checks on externalVideoProvider.ts ────────────
const provSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/providers/video/externalVideoProvider.ts"),
  "utf-8",
);

check("provider: accepts resumeProviderJobId",
  /resumeProviderJobId\?:\s*string/.test(provSrc));

check("provider: accepts onSubmitted callback",
  /onSubmitted\?:\s*\(providerJobId:\s*string\)\s*=>\s*Promise<void>/.test(provSrc));

check("provider: resume path skips submit",
  /RESUMING poll for existing providerJobId/.test(provSrc));

check("provider: SUBMIT_UNCERTAIN when onSubmitted fails",
  /SUBMIT_UNCERTAIN: provider accepted job/.test(provSrc));

check("provider: queue-worker legacy path preserved",
  /Legacy path \(queue-worker\)/.test(provSrc) || /setProviderJobId\(job\.queueJobId/.test(provSrc));

// ── 4. Mock provider untouched (compat check) ───────────────────
const mockSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/providers/video/mockProvider.ts"),
  "utf-8",
);
check("mock: still uses ffmpeg lavfi (no change)",
  /ffmpeg.*lavfi.*testsrc/.test(mockSrc) || /ffmpeg/.test(mockSrc));
check("mock: never touches network",
  !/fetch\(/.test(mockSrc));

// ── 5. Queue worker path preserved ──────────────────────────────
const qwSrc = fs.readFileSync(path.resolve(process.cwd(), "src/queue-worker.ts"), "utf-8");
check("queue-worker: still passes queueJobId",
  /runExternalVideoJob\(\{\s*payload:\s*job\.payload,\s*queueJobId:\s*job\.id/.test(qwSrc));

// ── 6. Migration check: no DB change required ───────────────────
const schemaSrc = fs.readFileSync(
  path.resolve(process.cwd(), "../../lib/db/src/schema/production_pipeline.ts"),
  "utf-8",
);
check("schema: provider_job_id column exists (no migration needed)",
  /providerJobId:\s*text\("provider_job_id"\)/.test(schemaSrc));
check("schema: retry_count exists",
  /retryCount:\s*integer\("retry_count"\)/.test(schemaSrc));
check("schema: max_retries exists",
  /maxRetries:\s*integer\("max_retries"\)/.test(schemaSrc));

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
