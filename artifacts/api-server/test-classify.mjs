// Pure function test — no DB.
function classifyError(err) {
  const cat = err?.category;
  if (typeof cat === "string" && cat.length > 0) return cat;
  const http = err?.httpStatus;
  if (http === 401 || http === 403) return "AUTH";
  if (http === 402) return "BILLING";
  if (http === 429) return "TRANSIENT";
  if (http === 400 || http === 422) {
    const body = String(err?.body || "").toLowerCase();
    if (body.includes("policy") || body.includes("content")) return "CONTENT_POLICY";
    return "INVALID_INPUT";
  }
  if (http >= 500) return "TRANSIENT";
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset")) return "PROVIDER_TIMEOUT";
  return "PERMANENT";
}
function isRetryable(c) { return c === "TRANSIENT" || c === "PROVIDER_TIMEOUT"; }

const cases = [
  [{ category: "MISCONFIGURATION" }, "MISCONFIGURATION", false],
  [{ category: "TRANSIENT" }, "TRANSIENT", true],
  [{ httpStatus: 429 }, "TRANSIENT", true],
  [{ httpStatus: 500 }, "TRANSIENT", true],
  [{ httpStatus: 401 }, "AUTH", false],
  [{ httpStatus: 402 }, "BILLING", false],
  [{ httpStatus: 400, body: "invalid param" }, "INVALID_INPUT", false],
  [{ httpStatus: 400, body: "content policy violation" }, "CONTENT_POLICY", false],
  [{ message: "Connection timeout occurred" }, "PROVIDER_TIMEOUT", true],
  [{ message: "Random internal error" }, "PERMANENT", false],
];
let pass = 0, fail = 0;
for (const [input, expCat, expRetry] of cases) {
  const gotCat = classifyError(input);
  const gotRetry = isRetryable(gotCat);
  const ok = gotCat === expCat && gotRetry === expRetry;
  console.log(`${ok ? "PASS" : "FAIL"}: ${JSON.stringify(input)} -> cat=${gotCat} retry=${gotRetry} (exp ${expCat}/${expRetry})`);
  ok ? pass++ : fail++;
}
console.log(`SUMMARY pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
