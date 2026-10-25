/**
 * KAYAN-GUARD-05: loadEnv must never print GPU_SSH_TARGET value to stdout.
 * Only a boolean "configured/missing" flag is permitted.
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const src = fs.readFileSync(
  path.resolve(process.cwd(), "src/loadEnv.ts"),
  "utf8",
);

// G5-01: source must NOT interpolate GPU_SSH_TARGET into the console.log
report("G5-01 no direct ${process.env.GPU_SSH_TARGET} in log", !/console\.log\([^)]*process\.env\.GPU_SSH_TARGET\b/.test(src));

// G5-02: must not use a template literal that includes the value
report("G5-02 no backtick interpolation of GPU_SSH_TARGET", !/`[^`]*\$\{process\.env\.GPU_SSH_TARGET\}[^`]*`/.test(src));

// G5-03: has a boolean presence flag
report("G5-03 presence flag derived (hasSshTarget)", /hasSshTarget\s*=\s*!!/.test(src));

// G5-04: log mentions configured|missing
report("G5-04 log says configured|missing", /gpuSshTarget=.*configured.*missing/.test(src) || /'configured'.*'missing'/.test(src));

// G5-05: dotenv override still applied
report("G5-05 dotenv override preserved", /dotenv\.config\(\{[^}]*override\s*:\s*true/.test(src));

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
