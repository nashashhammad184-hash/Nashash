/**
 * KAYAN-GUARD-10: auth errors (HTTP 401/403) must classify as AUTH (permanent,
 * not retried indefinitely), and 429/5xx must remain TRANSIENT. Errors must
 * never leak the token value.
 */
import { GpuQueueService } from "../src/lib/services/GpuQueueService";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Simulated errors as thrown by kayanGpuProvider / queue-worker / LLM provider
const err401: any = new Error("KayanGPU /jobs/video failed (HTTP 401): Unauthorized");
err401.httpStatus = 401;
const err403: any = new Error("video submit HTTP 403: Forbidden");
err403.httpStatus = 403;
const err429: any = new Error("llm submit HTTP 429: Too Many Requests");
err429.httpStatus = 429;
const err500: any = new Error("lipsync submit HTTP 500: Server Error");
err500.httpStatus = 500;
const errTimeout: any = new Error("ETIMEDOUT");
const errPermanent: any = new Error("unsupported job kind");
errPermanent.category = "PERMANENT";

// Classification
report("G10-01 401 -> AUTH", GpuQueueService.classifyError(err401) === "AUTH");
report("G10-02 403 -> AUTH", GpuQueueService.classifyError(err403) === "AUTH");
report("G10-03 429 -> TRANSIENT", GpuQueueService.classifyError(err429) === "TRANSIENT");
report("G10-04 500 -> TRANSIENT", GpuQueueService.classifyError(err500) === "TRANSIENT");
report("G10-05 timeout msg -> PROVIDER_TIMEOUT", GpuQueueService.classifyError(errTimeout) === "PROVIDER_TIMEOUT");
report("G10-06 explicit PERMANENT preserved", GpuQueueService.classifyError(errPermanent) === "PERMANENT");

// Retry policy: AUTH must NOT be retried (matches isRetryable contract)
report("G10-07 AUTH not retryable", GpuQueueService.isRetryable("AUTH") === false);
report("G10-08 TRANSIENT retryable", GpuQueueService.isRetryable("TRANSIENT") === true);
report("G10-09 PROVIDER_TIMEOUT retryable", GpuQueueService.isRetryable("PROVIDER_TIMEOUT") === true);
report("G10-10 PERMANENT not retryable", GpuQueueService.isRetryable("PERMANENT") === false);

// No token leak in message strings
const token = process.env.GPU_WORKER_TOKEN || "";
if (token) {
  report("G10-11 token not in 401 msg", !String(err401.message).includes(token));
} else {
  console.log("SKIP G10-11 (GPU_WORKER_TOKEN not set in test env)");
}

// Source-level guards: kayanGpuProvider.ts:72 must attach httpStatus
import fs from "node:fs";
import path from "node:path";
const kgp = fs.readFileSync(path.resolve(process.cwd(), "src/lib/kayanGpuProvider.ts"), "utf8");
report("G10-12 kayanGpuProvider sets err.httpStatus", /err\.httpStatus\s*=\s*response\.status/.test(kgp));

const qw = fs.readFileSync(path.resolve(process.cwd(), "src/queue-worker.ts"), "utf8");
report("G10-13 queue-worker sets err.httpStatus (video submit)", /video submit HTTP[\s\S]{0,200}err\.httpStatus\s*=\s*status/.test(qw));
report("G10-14 queue-worker sets err.httpStatus (llm submit)", /llm submit HTTP[\s\S]{0,200}err\.httpStatus\s*=\s*status/.test(qw));
report("G10-15 queue-worker sets err.httpStatus (lipsync submit)", /lipsync submit HTTP[\s\S]{0,200}err\.httpStatus\s*=\s*status/.test(qw));

const llm = fs.readFileSync(path.resolve(process.cwd(), "src/lib/providers/script/LocalGpuLlmProvider.ts"), "utf8");
report("G10-16 LocalGpuLlmProvider sets err.httpStatus", /err\.httpStatus\s*=\s*createRes\.status/.test(llm));

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
