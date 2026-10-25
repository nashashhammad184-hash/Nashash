/**
 * KAYAN-GUARD-13: validateVideoGenForProvider must fail fast BEFORE enqueue
 * when the external video provider cannot handle t2v or lacks a reference image.
 */
import { validateVideoGenForProvider } from "../src/routes/production";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const REF = "x".repeat(200);

// VIDEO_GEN + external
report("G13-01 external + t2v → reject",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "t2v", resolvedRef: null, videoProvider: "external" }).ok === false);
report("G13-02 external + undefined task → reject",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: undefined, resolvedRef: null, videoProvider: "external" }).ok === false);
report("G13-03 external + i2v + ref → accept",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "i2v", resolvedRef: REF, videoProvider: "external" }).ok === true);
report("G13-04 external + i2v + short ref → reject",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "i2v", resolvedRef: "short", videoProvider: "external" }).ok === false);
report("G13-05 external + i2v + null ref → reject",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "i2v", resolvedRef: null, videoProvider: "external" }).ok === false);

// Case insensitivity on provider
report("G13-06 EXTERNAL uppercase → reject",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "t2v", resolvedRef: null, videoProvider: "EXTERNAL" }).ok === false);

// kayangpu: no restriction (t2v is fine)
report("G13-07 kayangpu + t2v → accept",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "t2v", resolvedRef: null, videoProvider: "kayangpu" }).ok === true);
report("G13-08 kayangpu + undefined → accept",
  validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: undefined, resolvedRef: null, videoProvider: "kayangpu" }).ok === true);

// Other job types: no restriction
report("G13-09 VOICE_GEN + external → accept (no video task)",
  validateVideoGenForProvider({ type: "VOICE_GEN", resolvedTask: undefined, resolvedRef: null, videoProvider: "external" }).ok === true);
report("G13-10 LIP_SYNC + external → accept",
  validateVideoGenForProvider({ type: "LIP_SYNC", resolvedTask: undefined, resolvedRef: null, videoProvider: "external" }).ok === true);

// Error shape
const r = validateVideoGenForProvider({ type: "VIDEO_GEN", resolvedTask: "t2v", resolvedRef: null, videoProvider: "external" });
if (r.ok === false) {
  report("G13-11 error code = VIDEO_I2V_REQUIRED", r.error === "VIDEO_I2V_REQUIRED", r.error);
  report("G13-12 message mentions i2v", /i2v/.test(r.message), r.message);
} else {
  report("G13-11 error code = VIDEO_I2V_REQUIRED", false, "ok:true");
  report("G13-12 message mentions i2v", false, "ok:true");
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
