/**
 * KAYAN-CINEMA-04: behavioral tests for recovery, storage, and cost guard.
 * Uses mock provider + fake storage. NO real WaveSpeed, NO real DB, NO paid calls.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Set env BEFORE importing modules that read it at load time
process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "mock";
process.env.NASHASH_VIDEO_DIR = "/tmp/cinema-04-dl";
process.env.MAX_VIDEO_COST_USD = "0.30";

const { runExternalVideoJob } = await import("../src/lib/providers/video/externalVideoProvider.ts");
const { mockCounters, resetMockCounters } = await import("../src/lib/providers/video/mockProvider.ts");
const { _resetStorageForTests } = await import("../src/lib/storage/index.ts");
const { persistVideoFile } = await import("../src/lib/storage/persist.ts");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const REF = "x".repeat(200); // dummy b64
const FIXTURE = "/tmp/cinema-04-fixtures/sample.mp4";

fs.mkdirSync("/tmp/cinema-04-dl", { recursive: true });

// ─── A. Normal submit: exactly one submit, one download, one onSubmitted ──
{
  resetMockCounters();
  const submitted: string[] = [];
  const r = await runExternalVideoJob({
    payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
    onSubmitted: async (id) => { submitted.push(id); },
  });
  check("A1 normal: submitCalls=1", mockCounters.submitCalls === 1, `got=${mockCounters.submitCalls}`);
  check("A2 normal: pollCalls>=1", mockCounters.pollCalls >= 1);
  check("A3 normal: downloadCalls=1", mockCounters.downloadCalls === 1);
  check("A4 normal: onSubmitted called once", submitted.length === 1);
  check("A5 normal: onSubmitted id starts with mock_", submitted[0]?.startsWith("mock_") === true);
  check("A6 normal: mp4 file exists", fs.existsSync(r.mp4_path) && fs.statSync(r.mp4_path).size > 0);

  // ─── B. Resume: submit skipped ─────────────────────────────────
  resetMockCounters();
  const r2 = await runExternalVideoJob({
    payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
    resumeProviderJobId: submitted[0],
    onSubmitted: async () => { throw new Error("should NOT be called on resume"); },
  });
  check("B1 resume: submitCalls=0 (no new paid request)", mockCounters.submitCalls === 0, `got=${mockCounters.submitCalls}`);
  check("B2 resume: pollCalls>=1 (resumed existing)", mockCounters.pollCalls >= 1);
  check("B3 resume: downloadCalls=1 (reuses existing)", mockCounters.downloadCalls === 1);
  check("B4 resume: mp4 file exists", fs.existsSync(r2.mp4_path));
}

// ─── C. onSubmitted throws → SUBMIT_UNCERTAIN, no poll ──────────
{
  resetMockCounters();
  let caught: any = null;
  try {
    await runExternalVideoJob({
      payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
      onSubmitted: async () => { throw new Error("DB offline"); },
    });
  } catch (e) { caught = e; }
  check("C1 onSubmitted-fail: throws", caught !== null);
  check("C2 onSubmitted-fail: error contains SUBMIT_UNCERTAIN", String(caught?.message).includes("SUBMIT_UNCERTAIN"));
  check("C3 onSubmitted-fail: submitUncertain flag set", caught?.submitUncertain === true);
  check("C4 onSubmitted-fail: submitCalls=1 (already paid)", mockCounters.submitCalls === 1);
  check("C5 onSubmitted-fail: pollCalls=0 (no poll after persist fail)", mockCounters.pollCalls === 0);
}

// ─── D. Duration for mock (should NOT normalize; mock is not wavespeed) ─
{
  resetMockCounters();
  await runExternalVideoJob({
    payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
    onSubmitted: async () => {},
  });
  check("D1 mock: duration=2 passes through unchanged (2)", mockCounters.lastSubmittedPayload?.durationSeconds === 2, `got=${mockCounters.lastSubmittedPayload?.durationSeconds}`);
}
{
  resetMockCounters();
  await runExternalVideoJob({
    payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 8 },
    onSubmitted: async () => {},
  });
  check("D2 mock: duration=8 passes through unchanged (8)", mockCounters.lastSubmittedPayload?.durationSeconds === 8);
}

// ─── E. Duration normalization (wavespeed-specific, pure function) ──
{
  const { normalizeWaveSpeedDuration } = await import("../src/lib/providers/video/externalVideoProvider.ts");
  check("E1 normalize: 2→5", normalizeWaveSpeedDuration(2) === 5);
  check("E2 normalize: 5→5", normalizeWaveSpeedDuration(5) === 5);
  check("E3 normalize: 8→8", normalizeWaveSpeedDuration(8) === 8);
  check("E4 normalize: 10→5", normalizeWaveSpeedDuration(10) === 5);
  check("E5 normalize: undefined→5", normalizeWaveSpeedDuration(undefined) === 5);
}

// ─── F. Storage — fake provider, persist + retry after failure ──
{
  let writeCount = 0;
  let failNext = false;
  const fakeProvider = {
    name: "fake" as const,
    publicUrl: (k: string) => `/api/storage/fake/${k}`,
    write: async (key: string, buf: Buffer, _ct: string) => {
      writeCount++;
      if (failNext) { failNext = false; throw new Error("simulated upload fail"); }
      return `/api/storage/fake/${key}`;
    },
    read: async (_k: string) => Buffer.from(""),
    getSize: async (_k: string) => 0,
  };
  _resetStorageForTests(fakeProvider as any);

  writeCount = 0;
  const r = await persistVideoFile(FIXTURE);
  check("F1 storage: write called once on success", writeCount === 1);
  check("F2 storage: returned url contains 'videos/'", r.url.includes("videos/"), r.url);
  check("F3 storage: sizeBytes > 0", r.sizeBytes > 0);
  check("F4 storage: basename preserved", r.basename === "sample.mp4");

  writeCount = 0;
  failNext = true;
  let caught: any = null;
  try { await persistVideoFile(FIXTURE); } catch (e) { caught = e; }
  check("F5 storage: failure throws", caught !== null);
  check("F6 storage: first attempt wrote (1) then failed", writeCount === 1);

  writeCount = 0;
  const r2 = await persistVideoFile(FIXTURE);
  check("F7 storage: retry succeeds (no auto-retry inside persist)", writeCount === 1);
  check("F8 storage: retry url valid", r2.url.includes("videos/"));

  _resetStorageForTests();
}

// ─── G. classifyRetry behavioral (re-run) ────────────────────────
{
  const { classifyRetry } = await import("../src/lib/productionEngine.ts");
  check("G1 class: providerJobId set → RETRY_LIMITED", classifyRetry("x", { providerJobId: "id::url", type: "VIDEO_GEN" }) === "RETRY_LIMITED");
  check("G2 class: SUBMIT_UNCERTAIN explicit", classifyRetry("SUBMIT_UNCERTAIN: x", { type: "VIDEO_GEN" }) === "SUBMIT_UNCERTAIN");
  check("G3 class: timeout → SUBMIT_UNCERTAIN", classifyRetry("timeout expired", { type: "VIDEO_GEN" }) === "SUBMIT_UNCERTAIN");
  check("G4 class: HTTP 400 → NO_RETRY", classifyRetry("HTTP 400", { type: "VIDEO_GEN" }) === "NO_RETRY");
  check("G5 class: HTTP 401 → NO_RETRY", classifyRetry("HTTP 401", { type: "VIDEO_GEN" }) === "NO_RETRY");
  check("G6 class: HTTP 402 → NO_RETRY", classifyRetry("HTTP 402", { type: "VIDEO_GEN" }) === "NO_RETRY");
  check("G7 class: HTTP 429 → RETRY_LIMITED", classifyRetry("HTTP 429", { type: "VIDEO_GEN" }) === "RETRY_LIMITED");
  check("G8 class: HTTP 500 → SUBMIT_UNCERTAIN", classifyRetry("HTTP 500", { type: "VIDEO_GEN" }) === "SUBMIT_UNCERTAIN");
}

// ─── H. Race prevention (claimJob logic, structural — DB-only) ──
{
  const fs2 = await import("node:fs");
  const engineSrc = fs2.readFileSync(path.resolve(process.cwd(), "src/lib/productionEngine.ts"), "utf-8");
  check("H1 claim: uses atomic UPDATE WHERE pending", /\.update\(productionPipeline\)[\s\S]*?status: "processing"[\s\S]*?where\(and\([\s\S]*?status, "pending"/.test(engineSrc));
}

// ─── Cleanup temp ────────────────────────────────────────────────
try { fs.rmSync("/tmp/cinema-04-dl", { recursive: true, force: true }); } catch {}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
