/**
 * KAYAN-CINEMA-05: cost boundary tests (mocks only, no paid API calls).
 * Verifies MAX_VIDEO_COST_USD gate and duration normalization precede submit.
 */
process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "mock";

const { waveSpeedProvider } = await import("../src/lib/providers/video/waveSpeedProvider.ts");
const { normalizeWaveSpeedDuration } = await import("../src/lib/providers/video/externalVideoProvider.ts");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

// Price table: 480p = 0.02/s, 720p = 0.04/s
const cases: Array<[number, string, number, string]> = [
  // [duration, resolution, expectedCost, description]
  [5,  "480p", 0.10, "5s 480p"],
  [8,  "480p", 0.16, "8s 480p"],
  [5,  "720p", 0.20, "5s 720p"],
  [8,  "720p", 0.32, "8s 720p ← exceeds 0.30"],
];

for (const [dur, res, exp, desc] of cases) {
  const got = await waveSpeedProvider.estimateCost({
    task: "i2v",
    prompt: "x",
    referenceImageBase64: "x".repeat(200),
    durationSeconds: dur,
    resolution: res,
  });
  check(`estimateCost: ${desc} = $${exp.toFixed(2)}`, Math.abs(got - exp) < 1e-6, `got=$${got.toFixed(3)}`);
}

// Verify 8s 720p (0.32) exceeds default MAX (0.30)
{
  const cost = await waveSpeedProvider.estimateCost({
    task: "i2v", prompt: "x", referenceImageBase64: "x".repeat(200),
    durationSeconds: 8, resolution: "720p",
  });
  check("boundary: 8s 720p cost > $0.30", cost > 0.30, `cost=$${cost.toFixed(2)}`);
}

// Normalization: 2→5 must be applied BEFORE cost. If 2 passed through raw,
// cost would be 0.04; but normalized to 5, cost = 0.10.
{
  const raw2 = normalizeWaveSpeedDuration(2); // = 5
  check("normalize: 2 becomes 5 before cost", raw2 === 5);
  const cost = await waveSpeedProvider.estimateCost({
    task: "i2v", prompt: "x", referenceImageBase64: "x".repeat(200),
    durationSeconds: raw2, resolution: "480p",
  });
  check("normalize: cost of normalized 5s = $0.10 (not $0.04)", Math.abs(cost - 0.10) < 1e-6, `got=$${cost.toFixed(3)}`);
}

// Cost guard semantics: check what the code does when cost > MAX
// (Read the code to verify — no real submit here)
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/providers/video/externalVideoProvider.ts"), "utf-8");
check("gate: MAX_COST_USD check exists", /MAX_COST_USD/.test(src));
{
  const guardIdx = src.indexOf("if (estCost > MAX_COST_USD)");
  const submitIdx = src.indexOf("provider.submit(payload)");
  check("gate: check happens BEFORE provider.submit", guardIdx >= 0 && submitIdx > guardIdx, `guard=${guardIdx} submit=${submitIdx}`);
}
check("gate: raises BILLING category", /"BILLING" as const/.test(src));

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
