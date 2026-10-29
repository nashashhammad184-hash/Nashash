/**
 * KAYAN-7.1: cost-guard tests. Verifies BOTH paths:
 *   - waveSpeedProvider.submit() has its own guard (defense-in-depth)
 *   - externalVideoProvider.runExternalVideoJob() still guards (pre-existing,
 *     present at 929a9bf before KAYAN-7.1)
 */
const realFetch = globalThis.fetch;
let fetchCalls = 0;
(globalThis as any).fetch = async () => {
  fetchCalls++;
  throw new Error("TEST_FETCH_REACHED");
};

async function main() {
  process.env.MAX_VIDEO_COST_USD = "0.30";
  process.env.VIDEO_EXTERNAL_KIND = "wavespeed";
  process.env.WAVESPEED_API_KEY = "testkey";

  const { waveSpeedProvider } = await import("../src/lib/providers/video/waveSpeedProvider");
  const { runExternalVideoJob } = await import("../src/lib/providers/video/externalVideoProvider");

  const ref = "a".repeat(100);
  const payloadHigh: any = { task: "i2v", prompt: "x", referenceImageBase64: ref, durationSeconds: 8, resolution: "720p" };
  const payloadLow: any  = { task: "i2v", prompt: "x", referenceImageBase64: ref, durationSeconds: 5, resolution: "480p" };

  let passed = 0, failed = 0;
  function report(n: string, ok: boolean, x: string) {
    console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
    if (ok) passed++; else failed++;
  }

  // C1: direct submit, MAX=0.30, 8s/720p ($0.32) → COST_EXCEEDED, no fetch
  process.env.MAX_VIDEO_COST_USD = "0.30";
  {
    const before = fetchCalls;
    let err: any = null;
    try { await waveSpeedProvider.submit(payloadHigh); } catch (e: any) { err = e; }
    const msg = err ? err.message : "no throw";
    report("C1 direct submit COST_EXCEEDED", !!err && /COST_EXCEEDED/.test(msg) && fetchCalls === before, msg);
  }

  // C2: direct submit, MAX=1.00 → guard passes, fetch reached
  process.env.MAX_VIDEO_COST_USD = "1.00";
  {
    const before = fetchCalls;
    let err: any = null;
    try { await waveSpeedProvider.submit(payloadHigh); } catch (e: any) { err = e; }
    const msg = err ? err.message : "no throw";
    report("C2 direct submit MAX=1.00 reaches fetch", !!err && /TEST_FETCH_REACHED/.test(msg) && fetchCalls > before, msg);
  }

  // C3: wrapper (module-load MAX=0.30), 8s/720p → COST_EXCEEDED from wrapper
  {
    let err: any = null;
    try { await runExternalVideoJob({ payload: payloadHigh }); } catch (e: any) { err = e; }
    const msg = err ? err.message : "no throw";
    report("C3 wrapper COST_EXCEEDED", !!err && /Cost guard|COST_EXCEEDED/.test(msg), msg);
  }

  // C4: wrapper low cost ($0.10) → passes both guards → fetch reached
  {
    const before = fetchCalls;
    let err: any = null;
    try { await runExternalVideoJob({ payload: payloadLow }); } catch (e: any) { err = e; }
    const msg = err ? err.message : "no throw";
    report("C4 wrapper low cost reaches fetch", !!err && /TEST_FETCH_REACHED/.test(msg) && fetchCalls > before, msg);
  }

  (globalThis as any).fetch = realFetch;
  console.log("");
  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
