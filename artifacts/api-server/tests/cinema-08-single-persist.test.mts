/**
 * KAYAN-CINEMA-08: verify persistVideoFile is called EXACTLY ONCE per job.
 * Uses mock provider + a fake storage provider that counts writes.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "mock";
process.env.NASHASH_VIDEO_DIR = "/tmp/cinema-08-dl";

const { runExternalVideoJob } = await import("../src/lib/providers/video/externalVideoProvider.ts");
const { mockCounters, resetMockCounters } = await import("../src/lib/providers/video/mockProvider.ts");
const { _resetStorageForTests } = await import("../src/lib/storage/index.ts");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const REF = "x".repeat(200);
fs.mkdirSync("/tmp/cinema-08-dl", { recursive: true });

// Fake storage counting writes
let writeCount = 0;
const writes: string[] = [];
const fakeProvider = {
  name: "fake" as const,
  publicUrl: (k: string) => `/api/storage/fake/${k}`,
  write: async (key: string, _buf: Buffer, _ct: string) => {
    writeCount++;
    writes.push(key);
    return `/api/storage/fake/${key}`;
  },
  read: async (_k: string) => Buffer.from(""),
  getSize: async (_k: string) => 0,
};
_resetStorageForTests(fakeProvider as any);

// ── A. Normal run: exactly 1 write ─────────────────────────────
resetMockCounters();
writeCount = 0;
writes.length = 0;
const r = await runExternalVideoJob({
  payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
  onSubmitted: async () => {},
});
check("A1 submitCalls=1", mockCounters.submitCalls === 1);
check("A2 downloadCalls=1", mockCounters.downloadCalls === 1);
check("A3 storage writes = 1 (single persist)", writeCount === 1, `got=${writeCount}`);
check("A4 storageKey returned", typeof r.storageKey === "string" && r.storageKey.length > 0, r.storageKey);
check("A5 sizeBytes returned", typeof r.sizeBytes === "number" && r.sizeBytes > 0);
check("A6 remote_path is storage URL (not CDN)", r.remote_path === `/api/storage/fake/${r.storageKey}`);

// ── B. Resume: still exactly 1 write ───────────────────────────
resetMockCounters();
writeCount = 0;
writes.length = 0;
const r2 = await runExternalVideoJob({
  payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
  resumeProviderJobId: r.worker_jid,
  onSubmitted: async () => { throw new Error("should NOT be called on resume"); },
});
check("B1 resume: submitCalls=0", mockCounters.submitCalls === 0);
check("B2 resume: storage writes = 1 (single)", writeCount === 1, `got=${writeCount}`);
check("B3 resume: storageKey returned", typeof r2.storageKey === "string" && r2.storageKey.length > 0);

// ── C. Storage failure: NOT retried internally ────────────────
let failNext = true;
const failingProvider = {
  ...fakeProvider,
  write: async (key: string, _buf: Buffer, _ct: string) => {
    writeCount++;
    if (failNext) { failNext = false; throw new Error("simulated upload fail"); }
    return `/api/storage/fake/${key}`;
  },
};
_resetStorageForTests(failingProvider as any);
writeCount = 0;
let caught: any = null;
try {
  await runExternalVideoJob({
    payload: { task: "i2v", prompt: "test", referenceImageBase64: REF, durationSeconds: 2 },
    onSubmitted: async () => {},
  });
} catch (e) { caught = e; }
check("C1 storage failure throws", caught !== null);
check("C2 storage failure message mentions 'persist'", String(caught?.message || "").toLowerCase().includes("persist"));
check("C3 storage write attempted once (no auto-retry)", writeCount === 1, `got=${writeCount}`);
check("C4 submit already happened (paid, not retried)", mockCounters.submitCalls >= 1);

_resetStorageForTests();
try { fs.rmSync("/tmp/cinema-08-dl", { recursive: true, force: true }); } catch {}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
