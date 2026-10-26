/**
 * KAYAN-TASK-DEPLOY-04: verify startProductionWorker() is fully gated by
 * NASHASH_DISABLE_AUTO_WORKER=1 in index.ts.
 *
 * The test is static (reads index.ts) because actually running the full
 * index.mjs requires DB + network. The gate is a two-branch decision in
 * one function; a regex check confirms the call cannot happen when the
 * env var is "1".
 *
 * Additionally, we verify productionEngine.ts has the correct semantics:
 * workerInterval is created inside startProductionWorker, so skipping the
 * call skips both workerInterval and sweepInterval.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

const indexSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/index.ts"),
  "utf-8",
);
const engineSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/productionEngine.ts"),
  "utf-8",
);

// ── 1. The gate exists in index.ts ───────────────────────────────
report(
  "DEPLOY04-01 index.ts checks NASHASH_DISABLE_AUTO_WORKER",
  /NASHASH_DISABLE_AUTO_WORKER\s*===\s*["']1["']/.test(indexSrc),
);

// ── 2. startProductionWorker is called ONLY inside the else branch
// Extract the app.listen block. Verify:
//   - There is exactly ONE call to startProductionWorker() (the invocation, not the import).
//   - It is preceded (within the same callback) by an `else` after the disable check.
const listenIdx = indexSrc.indexOf("app.listen(port");
report("DEPLOY04-02 app.listen found in source", listenIdx >= 0);

if (listenIdx >= 0) {
  // Find the callback body (next ~20 lines after app.listen)
  const slice = indexSrc.slice(listenIdx, listenIdx + 1500);
  const callCount = (slice.match(/startProductionWorker\(\)/g) || []).length;
  report(
    "DEPLOY04-03 startProductionWorker invoked exactly once in listen block",
    callCount === 1,
    `count=${callCount}`,
  );
  // The check must come BEFORE the call, inside the same block
  const gatePos = slice.search(/NASHASH_DISABLE_AUTO_WORKER\s*===\s*["']1["']/);
  const callPos = slice.indexOf("startProductionWorker()");
  report(
    "DEPLOY04-04 disable check precedes startProductionWorker call",
    gatePos >= 0 && callPos > gatePos,
    `gatePos=${gatePos}, callPos=${callPos}`,
  );
  // Verify it's in an `else` branch (i.e., there is an `else` keyword between gate and call)
  if (gatePos >= 0 && callPos > gatePos) {
    const between = slice.slice(gatePos, callPos);
    report(
      "DEPLOY04-05 call is inside else branch",
      /\belse\b/.test(between),
    );
  } else {
    report("DEPLOY04-05 call is inside else branch", false, "cannot verify (positions wrong)");
  }
}

// ── 3. productionEngine.ts: workerInterval created inside startProductionWorker
const startFnIdx = engineSrc.indexOf("export function startProductionWorker");
report("DEPLOY04-06 startProductionWorker defined", startFnIdx >= 0);

if (startFnIdx >= 0) {
  // Extract function body (rough): find matching closing brace by scanning
  let depth = 0;
  let started = false;
  let endIdx = startFnIdx;
  for (let i = startFnIdx; i < engineSrc.length; i++) {
    const c = engineSrc[i];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) { endIdx = i; break; } }
  }
  const fnBody = engineSrc.slice(startFnIdx, endIdx + 1);
  report(
    "DEPLOY04-07 workerInterval created inside startProductionWorker",
    /workerInterval\s*=\s*setTimeout/.test(fnBody),
  );
  report(
    "DEPLOY04-08 sweepInterval gated inside startProductionWorker",
    /if\s*\(\s*!disableAuto/.test(fnBody),
  );
}

// ── 4. The stop function exists (defensive, in case of future use)
report(
  "DEPLOY04-09 stopProductionWorker exported (defensive)",
  /export function stopProductionWorker/.test(engineSrc),
);

// ── 5. Negative static: no stray call to startProductionWorker outside the gate
// Count total occurrences of `startProductionWorker()` in index.ts (excluding import line)
const allCalls = (indexSrc.match(/startProductionWorker\(\)/g) || []).length;
report(
  "DEPLOY04-10 no stray unguarded calls to startProductionWorker()",
  allCalls === 1,
  `count=${allCalls}`,
);

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
