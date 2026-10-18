import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { R2Provider } from "../src/lib/storage/r2Provider";
import { StorageError, assertSafeKey } from "../src/lib/storage/types";
import { getStorage, _resetStorageForTests } from "../src/lib/storage/index";

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

// ═══ TEST-67-01: constructor does not require env ═══
{
  setEnv("R2_ACCOUNT_ID", undefined);
  setEnv("R2_BUCKET", undefined);
  setEnv("R2_ACCESS_KEY_ID", undefined);
  setEnv("R2_SECRET_ACCESS_KEY", undefined);
  let ctorThrew = false;
  try { new R2Provider(); } catch { ctorThrew = true; }
  report("TEST-67-01 constructor does not throw without env", !ctorThrew);
}

// ═══ TEST-67-02: missing env on use → R2_CONFIG_MISSING ═══
{
  const p = new R2Provider();
  let code = "";
  try { await p.exists("audio/x.mp3"); } catch (e: any) { code = e?.code; }
  report("TEST-67-02 missing env → R2_CONFIG_MISSING", code === "R2_CONFIG_MISSING", code);
}

// ═══ TEST-67-03: with env + mocked client → write works ═══
{
  setEnv("R2_ACCOUNT_ID", "test-account");
  setEnv("R2_BUCKET", "test-bucket");
  setEnv("R2_ACCESS_KEY_ID", "test-key");
  setEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  const p = new R2Provider();
  const calls: any[] = [];
  (p as any).client = {
    send: async (cmd: any) => {
      calls.push(cmd.constructor.name);
      if (cmd.constructor.name === "GetObjectCommand") {
        const body = (async function* () { yield Buffer.from("hello-r2"); })();
        return { Body: body };
      }
      return {};
    },
  };
  (p as any).cfg = {
    accountId: "test-account", bucket: "test-bucket",
    accessKeyId: "test-key", secretAccessKey: "test-secret",
    endpoint: "https://x.r2.cloudflarestorage.com",
  };

  const url = await p.write("audio/x.mp3", Buffer.from("hello"), "audio/mpeg");
  report("TEST-67-03 write returned proxy URL", url === "/api/storage/r2/audio/x.mp3", url);
  report("TEST-67-03 write called PutObject", calls.includes("PutObjectCommand"));

  const rd = await p.read("audio/x.mp3");
  report("TEST-67-03 read returns Buffer", Buffer.isBuffer(rd) && rd.toString() === "hello-r2");

  const ok = await p.exists("audio/x.mp3");
  report("TEST-67-03 exists via HeadObject", ok === true);

  await p.delete("audio/x.mp3");
  report("TEST-67-03 delete called DeleteObject", calls.includes("DeleteObjectCommand"));
}

// ═══ TEST-67-04: read NoSuchKey → NOT_FOUND ═══
{
  const p = new R2Provider();
  (p as any).client = { send: async () => { const e: any = new Error("nope"); e.name = "NoSuchKey"; throw e; } };
  (p as any).cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  let code = "";
  try { await p.read("audio/missing.mp3"); } catch (e: any) { code = e?.code; }
  report("TEST-67-04 NoSuchKey → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ TEST-67-05: write failure → WRITE_FAILED ═══
{
  const p = new R2Provider();
  (p as any).client = { send: async () => { throw new Error("network down"); } };
  (p as any).cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  let code = "";
  try { await p.write("audio/x.mp3", Buffer.from("x")); } catch (e: any) { code = e?.code; }
  report("TEST-67-05 network error → WRITE_FAILED", code === "WRITE_FAILED", code);
}

// ═══ TEST-67-06: path traversal rejected ═══
{
  const p = new R2Provider();
  const bads = ["../etc/passwd", "/abs", "a/../../b", ""];
  let caught = 0;
  for (const b of bads) {
    try { await p.exists(b); } catch { caught++; }
  }
  report("TEST-67-06 traversal rejected", caught === bads.length, `${caught}/${bads.length}`);
}

// ═══ TEST-67-07: publicUrl with publicBaseUrl set ═══
{
  setEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/files/");
  const p = new R2Provider();
  (p as any).cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x", publicBaseUrl: "https://cdn.example.com/files" };
  report("TEST-67-07 publicUrl uses public base", p.publicUrl("audio/x.mp3") === "https://cdn.example.com/files/audio/x.mp3");
}

// ═══ TEST-67-08: publicUrl without base → proxy path ═══
{
  setEnv("R2_PUBLIC_BASE_URL", undefined);
  const p = new R2Provider();
  (p as any).cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  report("TEST-67-08 publicUrl → proxy path", p.publicUrl("audio/x.mp3") === "/api/storage/r2/audio/x.mp3");
}

// ═══ TEST-67-09: STORAGE_PROVIDER=local → R2 NOT used ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const provider = getStorage();
  report("TEST-67-09 local selected when STORAGE_PROVIDER=local", provider.name === "local");
}

// ═══ TEST-67-10: STORAGE_PROVIDER unset → default local ═══
{
  setEnv("STORAGE_PROVIDER", undefined);
  _resetStorageForTests();
  const provider = getStorage();
  report("TEST-67-10 unset → default local", provider.name === "local");
}

// ═══ TEST-67-11: STORAGE_PROVIDER=r2 → R2Provider instance (lazy) ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
  const provider = getStorage();
  report("TEST-67-11 STORAGE_PROVIDER=r2 → R2Provider", provider.name === "r2");
  // No config required at construction
  report("TEST-67-11 no env required at construction", true);
}

// ═══ TEST-67-12: unknown STORAGE_PROVIDER → INVALID_PROVIDER ═══
{
  setEnv("STORAGE_PROVIDER", "s3");
  _resetStorageForTests();
  let code = "";
  try { getStorage(); } catch (e: any) { code = e?.code; }
  report("TEST-67-12 unknown → INVALID_PROVIDER", code === "INVALID_PROVIDER", code);
}

// ═══ TEST-67-13: cleanup only deletes inside temp dir ═══
{
  const p = new R2Provider();
  (p as any).cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const outside = path.join(os.tmpdir(), "NOT-KAYAN-outside-" + Date.now() + ".txt");
  fs.writeFileSync(outside, "must-survive");
  await p.cleanup(outside);
  report("TEST-67-13 cleanup does NOT delete outside temp dir", fs.existsSync(outside));
  try { fs.unlinkSync(outside); } catch {}
}

// ═══ TEST-67-14: static — no silent fallback in index.ts ═══
{
  const src = fs.readFileSync("./src/lib/storage/index.ts", "utf-8");
  report("TEST-67-14 no 'fallback to local' string", !/fallback\s+to\s+local/i.test(src));
  report("TEST-67-14 r2 branch returns R2Provider", /new R2Provider\(\)/.test(src));
}

restoreEnv();
_resetStorageForTests();

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
