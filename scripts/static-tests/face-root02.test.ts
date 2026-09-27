/**
 * KAYAN-FACE-ROOT-02 static tests — NO GPU.
 * Verifies:
 *  1) T2V payload unchanged in shape
 *  2) I2V payload carries reference image
 *  3) Worker uses task="i2v"
 *  4) Worker uses transformer="480p_i2v"
 *  5) num_frames=49 valid
 *  6) num_frames=81 valid
 *  7) Values pass through Nashash → Worker without loss
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "..", "..");

function read(p: string): string { return fs.readFileSync(path.join(REPO, p), "utf8"); }

// Local re-implementations matching worker formulas (no import from GPU).
function alignNF(n: number, s = 4): number { return Math.max(s + 1, Math.floor(n / s) * s + 1); }
function calcNF(dur: number, fps = 16): number { return alignNF(Math.trunc(fps * dur) + 3, 4); }

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); pass++; }
  catch (e: any) { console.log(`FAIL ${name}: ${e.message}`); fail++; }
}

// ---- read files ----
const provider = read("artifacts/api-server/src/lib/kayanGpuProvider.ts");
const prodEng  = read("artifacts/api-server/src/lib/productionEngine.ts");
const pipeline = read("artifacts/api-server/src/routes/pipeline.ts");
const worker   = fs.readFileSync("/tmp/worker_main.py", "utf8");

t("T1 T2V payload shape preserved (prompt/seed/resolution/steps)", () => {
  assert.match(provider, /prompt: req\.prompt/);
  assert.match(provider, /seed: req\.seed \?\? 123/);
  assert.match(provider, /resolution: req\.resolution \?\? '480p'/);
  assert.match(provider, /steps: req\.steps \?\? \(task === "i2v" \? 8 : 4\)/);
  assert.match(provider, /task,\s*\n\s*\};/, "task key emitted");
});

t("T2 I2V payload carries reference_image_base64", () => {
  assert.match(provider, /payload\.reference_image_base64 = req\.referenceImageBase64/);
  assert.match(provider, /i2v requires referenceImageBase64/);
});

t("T3 Worker uses task=i2v", () => {
  assert.match(worker, /task="i2v"/);
  assert.match(worker, /task == "i2v"/);
});

t("T4 Worker uses transformer=480p_i2v", () => {
  assert.match(worker, /I2V_TRANSFORMER_NAME = "480p_i2v"/);
  assert.match(worker, /transformer_model_name=I2V_TRANSFORMER_NAME/);
});

t("T5 num_frames=49 mathematically valid", () => {
  assert.equal((49 - 1) % 4, 0);
  assert.equal(calcNF(3, 16), 49);
});

t("T6 num_frames=81 mathematically valid", () => {
  assert.equal((81 - 1) % 4, 0);
  assert.equal(calcNF(5, 16), 81);
});

t("T7 Values pass Nashash → Worker without loss (name parity)", () => {
  // Provider emits snake_case keys matching worker VideoJobRequest fields:
  for (const k of ["reference_image_base64","duration_seconds","fps","aspect_ratio","num_frames","negative_prompt","task"]) {
    assert.ok(provider.includes(k), `provider emits ${k}`);
    assert.ok(worker.includes(k),    `worker accepts ${k}`);
  }
  // Pipeline forwards to productionEngine
  assert.match(pipeline, /referenceImageBase64: input\.referenceImageBase64/);
  assert.match(prodEng,  /referenceImageBase64: refB64 \?\? null/);
});

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
