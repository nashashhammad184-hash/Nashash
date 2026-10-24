/**
 * KAYAN-CINEMA-07: backend submitUncertain flag tests.
 * Pure unit — no DB, no network, no paid calls.
 */
import { isSubmitUncertainError } from "../src/lib/productionEngine.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

// Exact messages produced by productionEngine.ts (562, 707)
const MSG_RUNTIME =
  "SUBMIT_UNCERTAIN: ambiguous submit state (may have been charged). " +
  "Manual check required via WaveSpeed dashboard. Original error: timeout";
const MSG_RECOVERY =
  "SUBMIT_UNCERTAIN (recovery): worker restart during external VIDEO_GEN " +
  "before providerJobId was persisted. Manual check required.";

// ── A. Positive detection (actual messages) ─────────────────────
check("A1 runtime SUBMIT_UNCERTAIN → true",
  isSubmitUncertainError(MSG_RUNTIME) === true);
check("A2 recovery SUBMIT_UNCERTAIN → true",
  isSubmitUncertainError(MSG_RECOVERY) === true);
check("A3 lowercase → true",
  isSubmitUncertainError("submit_uncertain: x") === true);

// ── B. Negative detection (normal errors) ───────────────────────
const normals = [
  "HTTP 400 invalid body",
  "HTTP 401 unauthorized",
  "HTTP 402 billing required",
  "Invalid duration value",
  "requires reference image",
  "timeout expired",
  "ECONNRESET",
  null,
  undefined,
  "",
];
for (const m of normals) {
  check(`B ${JSON.stringify(m)} → false`, isSubmitUncertainError(m as any) === false);
}

// ── C. Edge cases ───────────────────────────────────────────────
check("C1 embedded (not prefix) → true",
  isSubmitUncertainError("error: SUBMIT_UNCERTAIN happened") === true);
check("C2 non-string-ish → false",
  isSubmitUncertainError(0 as any) === false);
check("C3 whitespace-only → false",
  isSubmitUncertainError("   ") === false);

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
