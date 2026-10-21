/**
 * KAYAN-TASK-DEPLOY-15: static verification of login rate-limit config.
 * The behavioral proof is in TASK-FINAL testing against Render.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/auth.ts"), "utf-8");

// 1. loginLimiter: windowMs 15min, limit 10, validate false
report(
  "DEPLOY15-01 loginLimiter windowMs = 15min",
  /const loginLimiter = rateLimit\(\{[\s\S]{0,400}windowMs: 15 \* 60 \* 1000/.test(src),
);
report(
  "DEPLOY15-02 loginLimiter limit = 10",
  /const loginLimiter = rateLimit\(\{[\s\S]{0,400}limit: 10/.test(src),
);
report(
  "DEPLOY15-03 loginLimiter validate: false",
  /const loginLimiter = rateLimit\(\{[\s\S]{0,400}validate: false/.test(src),
);

// 2. globalLoginLimiter
report(
  "DEPLOY15-04 globalLoginLimiter exists with keyGenerator",
  /const globalLoginLimiter = rateLimit\(\{[\s\S]{0,500}keyGenerator: \(\) => "global-login"/.test(src),
);
report(
  "DEPLOY15-05 globalLoginLimiter windowMs = 1min",
  /const globalLoginLimiter = rateLimit\(\{[\s\S]{0,400}windowMs: 60 \* 1000/.test(src),
);
report(
  "DEPLOY15-06 globalLoginLimiter limit = 60",
  /const globalLoginLimiter = rateLimit\(\{[\s\S]{0,400}limit: 60/.test(src),
);

// 3. Both limiters applied to /auth/login
report(
  "DEPLOY15-07 /auth/login applies loginLimiter AND globalLoginLimiter",
  /router\.post\("\/auth\/login", loginLimiter, globalLoginLimiter,/.test(src),
);

// 4. Sanity: no residual `max:` in loginLimiter (deprecated in v8)
report(
  "DEPLOY15-08 loginLimiter uses `limit:`, not deprecated `max:`",
  !/const loginLimiter = rateLimit\(\{[\s\S]{0,400}\bmax:\s*\d+/.test(src),
);

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
