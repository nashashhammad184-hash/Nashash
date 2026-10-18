import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveStorageUrlToLocal, _resetStorageForTests } from "../src/lib/storage/index";

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
const T73B_DIR = path.join(UPLOADS_ROOT, "temp", "t73b");
fs.mkdirSync(T73B_DIR, { recursive: true });

// ═══ TEST-73B-01: valid local audio file resolves ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const key = "temp/t73b/valid.mp3";
  const abs = path.join(UPLOADS_ROOT, key);
  fs.writeFileSync(abs, Buffer.from("fake-mp3-bytes"));
  const r = await resolveStorageUrlToLocal(`/uploads/${key}`);
  report("TASK-73B-01 valid local resolves", r.path === abs);
  report("TASK-73B-01 wasRemote=false", r.wasRemote === false);
  await r.cleanup();
  report("TASK-73B-01 cleanup (local) keeps file", fs.existsSync(abs));
  fs.unlinkSync(abs);
}

// ═══ TEST-73B-02: missing local audio file → NOT_FOUND ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  let code = "";
  try { await resolveStorageUrlToLocal("/uploads/temp/t73b/missing.mp3"); }
  catch (e: any) { code = e?.code; }
  report("TASK-73B-02 missing → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ TEST-73B-03: r2 mock — resolve + cleanup works ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  setEnv("R2_ACCOUNT_ID", "test");
  setEnv("R2_BUCKET", "test");
  setEnv("R2_ACCESS_KEY_ID", "test");
  setEnv("R2_SECRET_ACCESS_KEY", "test");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  const body = (async function* () { yield Buffer.from("r2-voice-audio"); })();
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: body };
    return {};
  }};
  provider.cfg = { accountId: "test", bucket: "test", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/test.mp3");
  report("TASK-73B-03 r2 resolves to temp", fs.existsSync(r.path));
  report("TASK-73B-03 wasRemote=true", r.wasRemote === true);
  const content = fs.readFileSync(r.path, "utf-8");
  report("TASK-73B-03 bytes match", content === "r2-voice-audio");
  await r.cleanup();
  report("TASK-73B-03 cleanup deletes temp", !fs.existsSync(r.path));
}

// ═══ TEST-73B-04: cleanup runs even on ffprobe failure (pattern test) ═══
{
  // Simulate the try/finally pattern used in voice.ts
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  const body = (async function* () { yield Buffer.from("temp-for-fail"); })();
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "GetObjectCommand") return { Body: body };
    return {};
  }};
  provider.cfg = { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const r = await resolveStorageUrlToLocal("/api/storage/r2/audio/will-fail.mp3");
  const tempPath = r.path;
  report("TASK-73B-04 temp exists before try", fs.existsSync(tempPath));
  let errorThrown = false;
  try {
    // simulate ffprobe throwing
    throw new Error("simulated ffprobe failure");
  } catch {
    errorThrown = true;
  } finally {
    await r.cleanup();
  }
  report("TASK-73B-04 error was thrown", errorThrown);
  report("TASK-73B-04 cleanup ran in finally", !fs.existsSync(tempPath));
}

// ═══ TEST-73B-05: cleanup never removes permanent local file ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const key = "temp/t73b/permanent.mp3";
  const abs = path.join(UPLOADS_ROOT, key);
  fs.writeFileSync(abs, Buffer.from("permanent"));
  const r = await resolveStorageUrlToLocal(`/uploads/${key}`);
  // simulate failure path
  try { throw new Error("simulated"); } catch {} finally { await r.cleanup(); }
  report("TASK-73B-05 permanent file kept", fs.existsSync(abs));
  fs.unlinkSync(abs);
}

// ═══ TEST-73B-06: empty audioUrl → error (no silent pass) ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  let caught = 0;
  try { await resolveStorageUrlToLocal(""); } catch { caught++; }
  try { await resolveStorageUrlToLocal(null as any); } catch { caught++; }
  report("TASK-73B-06 empty/null rejected", caught === 2, `${caught}/2`);
}

// ═══ TEST-73B-07: static — voice.ts uses resolveStorageUrlToLocal + try/finally ═══
{
  const src = fs.readFileSync("./src/routes/voice.ts", "utf-8");
  report("TASK-73B-07 voice imports resolveStorageUrlToLocal", /resolveStorageUrlToLocal/.test(src));
  report("TASK-73B-07 try/finally present", /}\s*finally\s*\{\s*[\s\S]*?resolved\.cleanup\(\)/.test(src));
  report("TASK-73B-07 no audioPath=\"\" check on fs", !/!audioPath\s*\|\|[\s\S]{0,60}fs\.existsSync\(audioPath\)/.test(src));
  report("TASK-73B-07 no direct fs.existsSync(audioPath)", !/fs\.existsSync\(audioPath\)/.test(src));
}

// ═══ TEST-73B-08: response shape preserved (static check) ═══
{
  const src = fs.readFileSync("./src/routes/voice.ts", "utf-8");
  report("TASK-73B-08 returns audioUrl", /audioUrl,\s*\n/.test(src) || /audioUrl:/.test(src));
  report("TASK-73B-08 returns audioPath (as jobAudioPath)", /audioPath:\s*jobAudioPath/.test(src));
  report("TASK-73B-08 returns shotId", /shotId,\s*\n/.test(src) || /shotId:/.test(src));
  report("TASK-73B-08 status 201 preserved", /res\.status\(201\)\.json/.test(src));
}

restoreEnv();
_resetStorageForTests();
try { fs.rmSync(T73B_DIR, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
