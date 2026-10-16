/**
 * KAYAN-TASK-92: regression test for R2Provider.writeFromFile stream errors.
 *
 * Covers the two scenarios that were failing before the PassThrough fix:
 *   1. fs read error BEFORE the SDK consumes the stream.
 *   2. fs read error MID-STREAM, after bytes have already been pushed.
 *
 * In both cases, the requirement is:
 *   - no unhandled 'error' event / no process crash,
 *   - the returned Promise rejects with StorageError,
 *   - the rejection message contains the original fs error message.
 *
 * The test uses a local hang server so no B2 network I/O is performed.
 * fs.createReadStream is monkey-patched within this test process only.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Readable } from "node:stream";

const originalCreateReadStream = fs.createReadStream.bind(fs);
let readErrorMode: "none" | "before" | "mid" = "none";
const SENTINEL_PREFIX = "task92-read-error";

fs.createReadStream = function patched(p: any, opts?: any) {
  const name = String(p);
  if (name.includes(SENTINEL_PREFIX)) {
    if (readErrorMode === "before") {
      const s = new Readable({ read() {} });
      process.nextTick(() => s.destroy(new Error("task92 simulated read failure (before)")));
      return s as any;
    }
    if (readErrorMode === "mid") {
      let pushed = false;
      const s = new Readable({ read() {} });
      process.nextTick(() => {
        if (!pushed) { s.push(Buffer.alloc(1024, 0x55)); pushed = true; }
        setTimeout(() => s.destroy(new Error("task92 simulated read failure (mid)")), 30);
      });
      return s as any;
    }
  }
  return originalCreateReadStream(p, opts);
};

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_BUCKET = "test-bucket";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_CONNECT_TIMEOUT_MS = "1000";
process.env.R2_REQUEST_TIMEOUT_MS = "5000";

import { R2Provider } from "../src/lib/storage/r2Provider.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? " :: " + detail : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}${detail ? " :: " + detail : ""}`); }
}

let crash = false;
let crashDetail = "";
process.once("uncaughtException", (e: any) => { crash = true; crashDetail = e?.message || String(e); });
process.once("unhandledRejection", (e: any) => { crash = true; crashDetail = e?.message || String(e); });

// Local hang server: accepts, never responds. Guarantees the SDK PUT stays open
// so abort/error is the only path out of writeFromFile.
const hangServer = http.createServer(() => {});
await new Promise<void>((r) => hangServer.listen(0, "127.0.0.1", r));
process.env.R2_ENDPOINT = `http://127.0.0.1:${(hangServer.address() as any).port}`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "task92-stream-errors-"));
const beforeFile = path.join(tmpDir, `${SENTINEL_PREFIX}-before.bin`);
const midFile = path.join(tmpDir, `${SENTINEL_PREFIX}-mid.bin`);
fs.writeFileSync(beforeFile, "dummy-before");
fs.writeFileSync(midFile, Buffer.alloc(64 * 1024, 0x11));

// ---- Scenario 1: read error BEFORE consumption ---------------------------
readErrorMode = "before";
{
  const p = new R2Provider();
  let name = "";
  let msg = "";
  let rejected = false;
  try {
    await p.writeFromFile(beforeFile, "task92/before.bin", "application/octet-stream");
  } catch (e: any) {
    rejected = true;
    name = e?.name || "";
    msg = String(e?.message || "");
  }
  check("TASK92-01 before-consumption rejects", rejected);
  check("TASK92-02 before-consumption name is StorageError", name === "StorageError", name);
  check("TASK92-03 before-consumption preserves fs message", msg.includes("task92 simulated read failure (before)"), msg.slice(0, 120));
}

// ---- Scenario 2: read error MID-STREAM -----------------------------------
readErrorMode = "mid";
{
  const p = new R2Provider();
  let name = "";
  let msg = "";
  let rejected = false;
  try {
    await p.writeFromFile(midFile, "task92/mid.bin", "application/octet-stream");
  } catch (e: any) {
    rejected = true;
    name = e?.name || "";
    msg = String(e?.message || "");
  }
  check("TASK92-04 mid-stream rejects", rejected);
  check("TASK92-05 mid-stream name is StorageError", name === "StorageError", name);
  check("TASK92-06 mid-stream preserves fs message", msg.includes("task92 simulated read failure (mid)"), msg.slice(0, 120));
}

// Let any late unhandled events surface.
await new Promise((r) => setTimeout(r, 500));

check("TASK92-07 no crash/unhandled rejection", !crash, crashDetail);

hangServer.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
