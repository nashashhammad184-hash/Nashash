/**
 * KAYAN-CINEMA-05: UI helper tests for SUBMIT_UNCERTAIN detection.
 * Pure unit test — no DOM, no network, no paid calls.
 */
import { isSubmitUncertain, jobStatusBadge } from "../src/lib/production-status.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

// ── A. Detection ───────────────────────────────────────────────
check("A1 null → false", isSubmitUncertain(null) === false);
check("A2 undefined → false", isSubmitUncertain(undefined) === false);
check("A3 pending no error → false", isSubmitUncertain({ status: "pending" }) === false);
check("A4 failed normal error → false",
  isSubmitUncertain({ status: "failed", error: "HTTP 400 invalid" }) === false);
check("A5 SUBMIT_UNCERTAIN prefix → true",
  isSubmitUncertain({ status: "failed", error: "SUBMIT_UNCERTAIN: may have accepted" }) === true);
check("A6 case-insensitive → true",
  isSubmitUncertain({ status: "failed", error: "submit_uncertain: x" }) === true);
check("A7 embedded → true",
  isSubmitUncertain({ status: "failed", error: "prefix SUBMIT_UNCERTAIN suffix" }) === true);
check("A8 recovery marker → true",
  isSubmitUncertain({ status: "failed", error: "SUBMIT_UNCERTAIN (recovery): restart" }) === true);
check("A9 explicit flag → true",
  isSubmitUncertain({ status: "failed", submitUncertain: true }) === true);
check("A10 explicit false + normal error → false",
  isSubmitUncertain({ status: "failed", submitUncertain: false, error: "boom" }) === false);

// ── B. Badge mapping ───────────────────────────────────────────
{
  const b = jobStatusBadge({ status: "failed", error: "SUBMIT_UNCERTAIN: x" });
  check("B1 submit_uncertain label is amber", b.tone === "amber");
  check("B2 submit_uncertain label is manual-review", b.label.includes("مراجعة يدوية"));
}
{
  const b = jobStatusBadge({ status: "completed" });
  check("B3 completed → green", b.tone === "green" && b.label === "completed");
}
{
  const b = jobStatusBadge({ status: "failed", error: "normal error" });
  check("B4 normal failed → red", b.tone === "red" && b.label === "failed");
}
{
  const b = jobStatusBadge({ status: "processing" });
  check("B5 processing → blue", b.tone === "blue" && b.label === "processing");
}
{
  const b = jobStatusBadge({ status: "pending" });
  check("B6 pending → gray", b.tone === "gray" && b.label === "pending");
}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
