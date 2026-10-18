import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveStorageUrlToLocal, _resetStorageForTests, StorageError } from "../src/lib/storage/index";
import { LocalProvider } from "../src/lib/storage/localProvider";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t73a-"));
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

// Since getStorage() uses process.cwd()/uploads as root, we need to place
// test files in the real uploads/temp/t73a directory and use /uploads/ URLs.
// This is intentional: it exercises the exact production code path.
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const T73_DIR = path.join(UPLOADS_ROOT, "temp", "t73a");
fs.mkdirSync(T73_DIR, { recursive: true });

// ═══ TEST-73A-01: valid local /uploads/ URL → returns real path ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const key = "temp/t73a/valid.txt";
  const abs = path.join(UPLOADS_ROOT, key);
  fs.writeFileSync(abs, "hello-73a");
  const r = await resolveStorageUrlToLocal(`/uploads/${key}`);
  report("TASK-73A-01 returns real path", r.path === abs, r.path);
  report("TASK-73A-01 wasRemote=false for local", r.wasRemote === false);
  report("TASK-73A-01 file readable", fs.readFileSync(r.path, "utf-8") === "hello-73a");
  await r.cleanup();
  report("TASK-73A-01 cleanup (local) does NOT delete", fs.existsSync(abs));
  fs.unlinkSync(abs);
}

// ═══ TEST-73A-02: local URL pointing to missing file → NOT_FOUND ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  let code = "";
  try { await resolveStorageUrlToLocal("/uploads/temp/t73a/missing.txt"); }
  catch (e: any) { code = e?.code; }
  report("TASK-73A-02 missing file → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ TEST-73A-03: reject javascript:/data:/file: ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const bads = [
    "javascript:alert(1)",
    "data:audio/mp3;base64,AAAA",
    "file:///etc/passwd",
    "vbscript:x",
    "blob:x",
  ];
  let caught = 0;
  for (const b of bads) {
    try { await resolveStorageUrlToLocal(b); } catch { caught++; }
  }
  report("TASK-73A-03 all dangerous schemes rejected", caught === bads.length, `${caught}/${bads.length}`);
}

// ═══ TEST-73A-04: reject path traversal ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const bads = [
    "/uploads/../etc/passwd",
    "/uploads/temp/../../etc/passwd",
    "/uploads//abs",
    "/uploads/a/./b",
    "/uploads/temp/t73a/../../../etc/passwd",
  ];
  let caught = 0;
  for (const b of bads) {
    try { await resolveStorageUrlToLocal(b); } catch { caught++; }
  }
  report("TASK-73A-04 all traversal attempts rejected", caught === bads.length, `${caught}/${bads.length}`);
}

// ═══ TEST-73A-05: /api/storage/r2/ URL rejected when provider=local ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  let code = "";
  try { await resolveStorageUrlToLocal("/api/storage/r2/audio/x.mp3"); }
  catch (e: any) { code = e?.code; }
  report("TASK-73A-05 r2 URL rejected under local", code === "INVALID_URL", code);
}

// ═══ TEST-73A-06: external http(s) URL rejected without R2_PUBLIC_BASE_URL ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  setEnv("R2_PUBLIC_BASE_URL", undefined);
  _resetStorageForTests();
  let code = "";
  try { await resolveStorageUrlToLocal("https://cdn.example.com/audio/x.mp3"); }
  catch (e: any) { code = e?.code; }
  report("TASK-73A-06 external http rejected under local", code === "INVALID_URL", code);
}

// ═══ TEST-73A-07: unsupported URL shape rejected ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const bads = ["videos/x.mp4", "x.mp4", "/other/x.mp4", ""];
  let caught = 0;
  for (const b of bads) {
    try { await resolveStorageUrlToLocal(b); } catch { caught++; }
  }
  report("TASK-73A-07 unsupported shapes rejected", caught === bads.length, `${caught}/${bads.length}`);
}

// ═══ TEST-73A-08: non-string input rejected ═══
{
  let caught = 0;
  const bads: any[] = [null, undefined, 42, {}, []];
  for (const b of bads) {
    try { await resolveStorageUrlToLocal(b); } catch { caught++; }
  }
  report("TASK-73A-08 non-string inputs rejected", caught === bads.length, `${caught}/${bads.length}`);
}

// ═══ TEST-73A-09: r2 provider with mock — /api/storage/r2/<key> resolves ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  setEnv("R2_ACCOUNT_ID", "test-account");
  setEnv("R2_BUCKET", "test-bucket");
  setEnv("R2_ACCESS_KEY_ID", "test-key");
  setEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  _resetStorageForTests();
  // Mock the R2 client's send to return a body for GetObjectCommand
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  const body = (async function* () { yield Buffer.from("r2-mock-bytes"); })();
  provider.client = {
    send: async (cmd: any) => {
      if (cmd.constructor.name === "GetObjectCommand") return { Body: body };
      return {};
    },
  };
  provider.cfg = {
    accountId: "test-account", bucket: "test-bucket",
    accessKeyId: "test-key", secretAccessKey: "test-secret",
    endpoint: "https://x.r2.cloudflarestorage.com",
  };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/r2mocked.mp3");
  report("TASK-73A-09 r2 URL resolved to temp path", fs.existsSync(r.path), r.path);
  report("TASK-73A-09 wasRemote=true", r.wasRemote === true);
  const contents = fs.readFileSync(r.path, "utf-8");
  report("TASK-73A-09 downloaded bytes match", contents === "r2-mock-bytes");
  await r.cleanup();
  report("TASK-73A-09 cleanup deleted temp", !fs.existsSync(r.path));
}

// ═══ TEST-73A-10: cleanup is idempotent ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  const body = (async function* () { yield Buffer.from("x"); })();
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: body };
    return {};
  }};
  provider.cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/cleanup.mp3");
  let threw = false;
  try { await r.cleanup(); await r.cleanup(); await r.cleanup(); } catch { threw = true; }
  report("TASK-73A-10 multiple cleanup calls safe", !threw);
}

// ═══ TEST-73A-11: static check — no HTTP route added ═══
{
  const idx = fs.readFileSync("./src/lib/storage/index.ts", "utf-8");
  report("TASK-73A-11 no Router/express in storage/index", !/from "express"|Router\(/.test(idx));
}

// ═══ TEST-73A-12: resolveStorageUrlToLocal exported ═══
{
  const idx = fs.readFileSync("./src/lib/storage/index.ts", "utf-8");
  report("TASK-73A-12 resolveStorageUrlToLocal exported", /export async function resolveStorageUrlToLocal/.test(idx));
}

restoreEnv();
_resetStorageForTests();
try { fs.rmSync(T73_DIR, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
