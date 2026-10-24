import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { persistVideoFile, persistAudioFile } from "../src/lib/storage/persist";
import { _resetStorageForTests } from "../src/lib/storage/index";

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
const T73D_DIR = path.join(UPLOADS_ROOT, "temp", "t73d");
fs.mkdirSync(T73D_DIR, { recursive: true });

// ═══ TEST-73D-01: local video at uploads/videos/ → no re-write, returns URL ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const videoPath = path.join(UPLOADS_ROOT, "videos", "test73d.mp4");
  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  fs.writeFileSync(videoPath, Buffer.alloc(1024, 0xab));
  const r = await persistVideoFile(videoPath);
  report("TASK-73D-01 url shape /uploads/videos/", r.url === "/uploads/videos/test73d.mp4", r.url);
  report("TASK-73D-01 key shape", r.key === "videos/test73d.mp4");
  report("TASK-73D-01 sizeBytes", r.sizeBytes === 1024);
  fs.unlinkSync(videoPath);
}

// ═══ TEST-73D-02: local temp video → copied to uploads/videos/ ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const tmpVideo = path.join(T73D_DIR, "temp-source.mp4");
  fs.writeFileSync(tmpVideo, Buffer.alloc(2048, 0xcd));
  const r = await persistVideoFile(tmpVideo);
  report("TASK-73D-02 key uses basename", r.key === "videos/temp-source.mp4");
  report("TASK-73D-02 target exists", fs.existsSync(path.join(UPLOADS_ROOT, r.key)));
  report("TASK-73D-02 source untouched", fs.existsSync(tmpVideo));
  // cleanup both
  try { fs.unlinkSync(tmpVideo); } catch {}
  try { fs.unlinkSync(path.join(UPLOADS_ROOT, r.key)); } catch {}
}

// ═══ TEST-73D-03: empty file rejected ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const emptyFile = path.join(T73D_DIR, "empty.mp4");
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  let caught = false;
  try { await persistVideoFile(emptyFile); } catch { caught = true; }
  report("TASK-73D-03 empty file rejected", caught);
  fs.unlinkSync(emptyFile);
}

// ═══ TEST-73D-04: missing file rejected ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  let caught = false;
  try { await persistVideoFile("/tmp/nonexistent-73d.mp4"); } catch { caught = true; }
  report("TASK-73D-04 missing file rejected", caught);
}

// ═══ TEST-73D-05: invalid path rejected ═══
{
  let caught = 0;
  try { await persistVideoFile(""); } catch { caught++; }
  try { await persistVideoFile(null as any); } catch { caught++; }
  report("TASK-73D-05 empty/null rejected", caught === 2, `${caught}/2`);
}

// ═══ TEST-73D-06: R2 mock write + read-back ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  setEnv("R2_ACCOUNT_ID", "test");
  setEnv("R2_BUCKET", "test");
  setEnv("R2_ACCESS_KEY_ID", "test");
  setEnv("R2_SECRET_ACCESS_KEY", "test");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  let uploadedKey = "";
  let uploadedSize = 0;
  provider.client = { send: async (cmd: any) => {
    if (cmd.constructor.name === "PutObjectCommand") {
      uploadedKey = cmd.input.Key;
      // KAYAN-TASK-73J: Body is now a ReadStream. Consume it to measure size.
      const chunks: Buffer[] = [];
      for await (const c of cmd.input.Body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      uploadedSize = Buffer.concat(chunks).length;
      return {};
    }
    if (cmd.constructor.name === "GetObjectCommand") {
      // simulate read-back with same size
      const body = (async function* () { yield Buffer.alloc(uploadedSize, 0xef); })();
      return { Body: body };
    }
    return {};
  }};
  provider.cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const tmpVideo = path.join(T73D_DIR, "r2-video.mp4");
  fs.writeFileSync(tmpVideo, Buffer.alloc(4096, 0xef));
  const r = await persistVideoFile(tmpVideo);
  report("TASK-73D-06 uploaded to correct key", uploadedKey === "videos/r2-video.mp4", uploadedKey);
  report("TASK-73D-06 uploaded correct size", uploadedSize === 4096, `${uploadedSize}`);
  report("TASK-73D-06 URL is proxy path", r.url.startsWith("/api/storage/r2/"), r.url);
  fs.unlinkSync(tmpVideo);
}

// ═══ TEST-73D-07: R2 write failure → throw, no silent success ═══
{
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
  const { getStorage } = await import("../src/lib/storage/index");
  const provider: any = getStorage();
  provider.client = { send: async (cmd: any) => {
    // KAYAN-TASK-73J: consume stream even on failure to avoid dangling fd.
    if (cmd?.input?.Body && typeof cmd.input.Body[Symbol.asyncIterator] === "function") {
      try { for await (const _ of cmd.input.Body) { /* drain */ } } catch {}
    }
    throw new Error("simulated network fail");
  }};
  provider.cfg = { accountId: "t", bucket: "t", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://x" };
  const tmpVideo = path.join(T73D_DIR, "fail-video.mp4");
  fs.writeFileSync(tmpVideo, Buffer.alloc(512));
  let threw = false;
  let errMsg = "";
  try { await persistVideoFile(tmpVideo); } catch (e: any) { threw = true; errMsg = e?.message || ""; }
  report("TASK-73D-07 R2 write failure throws", threw);
  report("TASK-73D-07 error mentions write/persist failure", /write failed|writeFromFile failed|persist/i.test(errMsg));
  fs.unlinkSync(tmpVideo);
}

// ═══ TEST-73D-08: audio persist helper ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  const tmpAudio = path.join(T73D_DIR, "audio.mp3");
  fs.writeFileSync(tmpAudio, Buffer.alloc(1024));
  const r = await persistAudioFile(tmpAudio);
  report("TASK-73D-08 audio URL shape", r.url === "/uploads/audio/audio.mp3", r.url);
  try { fs.unlinkSync(tmpAudio); } catch {}
  try { fs.unlinkSync(path.join(UPLOADS_ROOT, r.key)); } catch {}
}

// ═══ TEST-73D-09: static — external provider persists ═══
{
  const src = fs.readFileSync("./src/lib/providers/video/externalVideoProvider.ts", "utf-8");
  report("TASK-73D-09 imports persistVideoFile", /persistVideoFile/.test(src));
  report("TASK-73D-09 uses persistVideoFile after download", /provider\.download\([\s\S]{0,2000}persistVideoFile/.test(src));
  report("TASK-73D-09 sets remote_path to storage URL", /remote_path:\s*storageUrl/.test(src));
  report("TASK-73D-09 fails on persist error", /storage persist failed/.test(src));
}

// ═══ TEST-73D-10: static — kayanGpuProvider prefers remote_path ═══
{
  const src = fs.readFileSync("./src/lib/kayanGpuProvider.ts", "utf-8");
  report("TASK-73D-10 prefers remote_path", /r\.remote_path/.test(src));
  report("TASK-73D-10 falls back to /uploads/videos/", /fallback|basename\(r\.mp4_path/.test(src));
}

restoreEnv();
_resetStorageForTests();
try { fs.rmSync(T73D_DIR, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
