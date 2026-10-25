/**
 * KAYAN-CINEMA-12: guard test — prevent any test script from SELECTing
 * the non-existent "submit_uncertain" column on production_pipeline.
 * submitUncertain is DERIVED in rowToJob() from error_message; not stored.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const SCHEMA_FILE = path.resolve(process.cwd(), "../../lib/db/src/schema/production_pipeline.ts");
const schemaSrc = fs.readFileSync(SCHEMA_FILE, "utf-8");

// 1. Confirm the schema does NOT have a submit_uncertain column
check("schema: NO submit_uncertain column (field is derived)",
  !/submit_uncertain/i.test(schemaSrc),
  "derived in rowToJob");

// 2. Confirm the schema DOES have the fields derived from
check("schema: has error_message column",
  /errorMessage:\s*text\("error_message"\)/.test(schemaSrc));

// 3. Scan test scripts for any SELECT with submit_uncertain
const TEST_DIR = path.resolve(process.cwd(), ".");
const candidates = [
  "cinema-11-paid-test.mjs",
  "cinema-02c-test.mjs",
];
for (const f of candidates) {
  const fullPath = path.join(TEST_DIR, f);
  if (!fs.existsSync(fullPath)) {
    check(`guard: ${f} not present (skip)`, true, "not found — ok");
    continue;
  }
  const src = fs.readFileSync(fullPath, "utf-8");
  // Look for "SELECT ... submit_uncertain ... FROM production_pipeline"
  const hasBadSelect = /SELECT[^;]{0,300}submit_uncertain[^;]{0,300}FROM\s+production_pipeline/i.test(src);
  check(`guard: ${f} — no SELECT on submit_uncertain`, !hasBadSelect);
}

// 4. Verify cinema-11 test now uses regex on error_message instead
if (fs.existsSync(path.join(TEST_DIR, "cinema-11-paid-test.mjs"))) {
  const src = fs.readFileSync(path.join(TEST_DIR, "cinema-11-paid-test.mjs"), "utf-8");
  check("cinema-11: uses regex detection on error_message",
    /submit_uncertain/i.test(src) && /\.test\(.*error_message/i.test(src));
}

// 5. Sanity: rowToJob derives submitUncertain from error_message
const engineSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/productionEngine.ts"),
  "utf-8",
);
check("engine: rowToJob derives submitUncertain from error_message",
  /submitUncertain:\s*isSubmitUncertainError\(row\.errorMessage\)/.test(engineSrc));

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
