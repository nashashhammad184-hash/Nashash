import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { R2Provider } from "../src/lib/storage/r2Provider";
import { _resetStorageForTests, StorageError } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
function restoreEnv() {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]!;
  }
}

// Make a R2Provider with a mocked client
function makeProvider(mockSend: (cmd: any) => Promise<any>): R2Provider {
  const p = new R2Provider();
  (p as any).client = { send: mockSend };
  (p as any).cfg = {
    accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s",
    endpoint: "https://x.r2.cloudflarestorage.com",
  };
  return p;
}

// ═══ TEST-73G-01: 10 MB stream download → correct file on disk ═══
{
  const CHUNK = Buffer.alloc(1024 * 1024, 0xab); // 1 MB
  const TOTAL_CHUNKS = 10; // 10 MB total
  let sent = 0;
  const gen = async function* () {
    for (let i = 0; i < TOTAL_CHUNKS; i++) { sent += CHUNK.length; yield CHUNK; }
  };
  const p = makeProvider(async (cmd) => {
    if (cmd.constructor.name === "GetObjectCommand") {
      return { Body: Readable.from(gen()) };
    }
    return {};
  });
  const localPath = await p.localPath("videos/big.mp4");
  const st = fs.statSync(localPath);
  report("TASK-73G-01 10MB file written", st.size === 10 * 1024 * 1024, `${st.size}`);
  report("TASK-73G-01 file exists", fs.existsSync(localPath));
  await p.cleanup(localPath);
  report("TASK-73G-01 cleanup removed temp", !fs.existsSync(localPath));
}

// ═══ TEST-73G-02: stream failure → partial file cleaned up ═══
{
  const gen = async function* () {
    yield Buffer.alloc(1024);
    throw new Error("simulated stream break");
  };
  const p = makeProvider(async (cmd) => {
    if (cmd.constructor.name === "GetObjectCommand") {
      return { Body: Readable.from(gen()) };
    }
    return {};
  });
  let threw = false;
  let errCode = "";
  try { await p.localPath("videos/broken.mp4"); }
  catch (e: any) { threw = true; errCode = e?.code; }
  report("TASK-73G-02 stream failure throws", threw);
  report("TASK-73G-02 error code READ_FAILED", errCode === "READ_FAILED", errCode);
}

// ═══ TEST-73G-03: missing object → NOT_FOUND ═══
{
  const p = makeProvider(async (cmd) => {
    const err: any = new Error("nope"); err.name = "NoSuchKey";
    throw err;
  });
  let code = "";
  try { await p.localPath("videos/nope.mp4"); } catch (e: any) { code = e?.code; }
  report("TASK-73G-03 NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ TEST-73G-04: empty body → error ═══
{
  const p = makeProvider(async (cmd) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: null };
    return {};
  });
  let code = "";
  try { await p.localPath("videos/empty.mp4"); } catch (e: any) { code = e?.code; }
  report("TASK-73G-04 null body → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ TEST-73G-05: zero-byte stream → error ═══
{
  const gen = async function* () { /* nothing */ };
  const p = makeProvider(async (cmd) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: Readable.from(gen()) };
    return {};
  });
  let code = "";
  try { await p.localPath("videos/zero.mp4"); } catch (e: any) { code = e?.code; }
  report("TASK-73G-05 zero-byte rejected", code === "READ_FAILED", code);
}

// ═══ TEST-73G-06: static — timeouts configured ═══
{
  const src = fs.readFileSync("./src/lib/storage/r2Provider.ts", "utf-8");
  report("TASK-73G-06 has NodeHttpHandler", /NodeHttpHandler/.test(src));
  report("TASK-73G-06 has connectionTimeout", /connectionTimeout/.test(src));
  report("TASK-73G-06 has requestTimeout", /requestTimeout/.test(src));
  report("TASK-73G-06 has maxAttempts", /maxAttempts/.test(src));
}

// ═══ TEST-73G-07: static — streaming (no full buffer in localPath) ═══
{
  const src = fs.readFileSync("./src/lib/storage/r2Provider.ts", "utf-8");
  report("TASK-73G-07 uses streamPipeline", /streamPipeline/.test(src));
  report("TASK-73G-07 uses createWriteStream", /createWriteStream/.test(src));
  // In localPath, avoid the old `const buf = await this.read(key)` pattern
  const localPathSection = src.slice(src.indexOf("async localPath"), src.indexOf("async cleanup"));
  report("TASK-73G-07 localPath does NOT buffer", !/const buf = await this\.read\(/.test(localPathSection));
}

// ═══ TEST-73G-08: cleanup rejects files outside temp dir ═══
{
  const p = new R2Provider();
  (p as any).cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const outside = path.join(os.tmpdir(), "task73g-outside-" + Date.now() + ".txt");
  fs.writeFileSync(outside, "keep-me");
  await p.cleanup(outside);
  report("TASK-73G-08 outside file kept", fs.existsSync(outside));
  fs.unlinkSync(outside);
}

restoreEnv();
_resetStorageForTests();
console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
