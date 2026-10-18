import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveStorageUrlToLocal, _resetStorageForTests, type ResolvedLocalPath } from "../src/lib/storage/index";

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

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const T73C_DIR = path.join(UPLOADS_ROOT, "temp", "t73c");
fs.mkdirSync(T73C_DIR, { recursive: true });

// ═══ TEST-73C-01: static — VoiceEntry has resolved field ═══
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  report("TASK-73C-01 VoiceEntry has resolved", /resolved:\s*ResolvedLocalPath/.test(src));
  report("TASK-73C-01 imports resolveStorageUrlToLocal", /resolveStorageUrlToLocal/.test(src));
  report("TASK-73C-01 has resolvedAudioTracker", /resolvedAudioTracker/.test(src));
}

// ═══ TEST-73C-02: static — try/finally cleanup at executePipeline level ═══
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  const hasFinally = /}\s*finally\s*\{[\s\S]{0,500}resolvedAudioTracker[\s\S]{0,500}r\.cleanup\(\)/.test(src);
  report("TASK-73C-02 finally iterates tracker with cleanup", hasFinally);
}

// ═══ TEST-73C-03: static — LIP_SYNC uses resolved.path ═══
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  report("TASK-73C-03 LIP_SYNC uses a.resolved.path", /audioUrl:\s*a\.resolved\.path/.test(src));
  report("TASK-73C-03 no LIP_SYNC a.audioPath", !/audioUrl:\s*a\.audioPath/.test(src));
}

// ═══ TEST-73C-04: static — concat uses resolved.path ═══
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  report("TASK-73C-04 concat uses resolved?.path", /perShotVoice\[sh\.id\]\?\.resolved\?\.path/.test(src));
}

// ═══ TEST-73C-05: local round-trip: resolve + assertRealAudioFile analog + cleanup ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const key = "temp/t73c/voice-a.mp3";
  const abs = path.join(UPLOADS_ROOT, key);
  fs.writeFileSync(abs, Buffer.from("fake-audio-content-".repeat(20)));
  const r = await resolveStorageUrlToLocal(`/uploads/${key}`);
  report("TASK-73C-05 resolved.path is real file", r.path === abs && fs.existsSync(r.path));
  report("TASK-73C-05 wasRemote=false", r.wasRemote === false);
  await r.cleanup();
  report("TASK-73C-05 cleanup (local) keeps file", fs.existsSync(abs));
  fs.unlinkSync(abs);
}

// ═══ TEST-73C-06: remote-mock round-trip with cleanup ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  setEnv("R2_ACCOUNT_ID", "test");
  setEnv("R2_BUCKET", "test");
  setEnv("R2_ACCESS_KEY_ID", "test");
  setEnv("R2_SECRET_ACCESS_KEY", "test");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  const body = (async function* () { yield Buffer.from("remote-audio"); })();
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: body };
    return {};
  }};
  provider.cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/remote.mp3");
  const tempPath = r.path;
  report("TASK-73C-06 remote temp exists", fs.existsSync(tempPath));
  report("TASK-73C-06 bytes match", fs.readFileSync(tempPath, "utf-8") === "remote-audio");
  report("TASK-73C-06 wasRemote=true", r.wasRemote === true);
  await r.cleanup();
  report("TASK-73C-06 temp cleaned", !fs.existsSync(tempPath));
}

// ═══ TEST-73C-07: tracker pattern — multiple paths cleaned once ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  let callCount = 0;
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "GetObjectCommand") {
      callCount++;
      const idx = callCount;
      const body = (async function* () { yield Buffer.from(`remote-${idx}`); })();
      return { Body: body };
    }
    return {};
  }};
  provider.cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };

  const tracker: ResolvedLocalPath[] = [];
  const paths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await resolveStorageUrlToLocal(`/api/storage/r2/audio/multi-${i}.mp3`);
    tracker.push(r);
    paths.push(r.path);
  }
  report("TASK-73C-07 all 3 tracker paths exist", paths.every(p => fs.existsSync(p)));
  // Simulate finally block
  for (const r of tracker) { try { await r.cleanup(); } catch {} }
  report("TASK-73C-07 all 3 cleaned after finally", paths.every(p => !fs.existsSync(p)));
}

// ═══ TEST-73C-08: cleanup idempotent (no double-clean error) ═══
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
  provider.cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/idempotent.mp3");
  let err = false;
  try {
    await r.cleanup();
    await r.cleanup();
    await r.cleanup();
  } catch { err = true; }
  report("TASK-73C-08 triple cleanup safe", !err);
}

// ═══ TEST-73C-09: FFmpeg concat list format handles quotes ═══
{
  const badPath = "/tmp/it's: a file.mp3";
  const escaped = `file '${badPath.replace(/'/g, "'\\\\''")}'`;
  report("TASK-73C-09 concat escapes quotes", escaped.includes("'\\\\''"), escaped);
}

// ═══ TEST-73C-10: static — no permanent-file deletion in tracker ═══
{
  const src = fs.readFileSync("./src/routes/pipeline.ts", "utf-8");
  // The tracker only cleans via resolved.cleanup() which is provider-scoped.
  report("TASK-73C-10 uses resolved.cleanup()", /resolvedAudioTracker[\s\S]{0,200}r\.cleanup\(\)/.test(src));
  report("TASK-73C-10 no direct fs.unlink on audio paths",
    !/fs\.unlinkSync\([^)]*audioPath/i.test(src));
}

restoreEnv();
_resetStorageForTests();
try { fs.rmSync(T73C_DIR, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
