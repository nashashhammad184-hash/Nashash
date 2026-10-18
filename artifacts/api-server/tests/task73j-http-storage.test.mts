import http from "node:http";
import express from "express";
import { Readable } from "node:stream";
import storageRouter from "../src/routes/storage";
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

// Setup: STORAGE_PROVIDER=r2 with a mock client
setEnv("STORAGE_PROVIDER", "r2");
setEnv("R2_ACCOUNT_ID", "test");
setEnv("R2_BUCKET", "test-bucket");
setEnv("R2_ACCESS_KEY_ID", "test");
setEnv("R2_SECRET_ACCESS_KEY", "test");
_resetStorageForTests();
const { getStorage } = await import("../src/lib/storage/index");
const provider: any = getStorage();

// Mock data
const KNOWN: Record<string, Buffer> = {
  "audio/test.mp3": Buffer.from("fake-mp3-bytes-" + "x".repeat(100)),
  "videos/movie.mp4": Buffer.from("fake-mp4-bytes-" + "y".repeat(1000)),
  "subtitles/test.srt": Buffer.from("1\n00:00:00,000 --> 00:00:05,000\nHello\n"),
};

provider.client = { send: async (cmd: any) => {
  if (cmd.constructor.name === "GetObjectCommand") {
    const key = cmd.input.Key;
    const buf = KNOWN[key];
    if (!buf) {
      const err: any = new Error("NoSuchKey"); err.name = "NoSuchKey";
      throw err;
    }
    return { Body: Readable.from([buf]) };
  }
  return {};
}};
provider.cfg = {
  accountId: "test", bucket: "test-bucket",
  accessKeyId: "k", secretAccessKey: "s",
  endpoint: "https://x.r2.cloudflarestorage.com",
};

// Build minimal Express app with only storage router at /api
const app = express();
app.use("/api", storageRouter);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

// ═══ TEST-73J-H01: existing file → 200 + correct body ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/audio/test.mp3`);
  const body = Buffer.from(await r.arrayBuffer());
  report("TASK-73J-H01 status 200", r.status === 200, `status=${r.status}`);
  report("TASK-73J-H01 body matches", body.equals(KNOWN["audio/test.mp3"]));
}

// ═══ TEST-73J-H02: Content-Type for mp3 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/audio/test.mp3`);
  await r.arrayBuffer();
  report("TASK-73J-H02 audio/mpeg", r.headers.get("content-type") === "audio/mpeg");
}

// ═══ TEST-73J-H03: Content-Type for mp4 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/videos/movie.mp4`);
  await r.arrayBuffer();
  report("TASK-73J-H03 video/mp4", r.headers.get("content-type") === "video/mp4");
}

// ═══ TEST-73J-H04: Content-Type for srt ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/subtitles/test.srt`);
  await r.arrayBuffer();
  const ct = r.headers.get("content-type") || "";
  report("TASK-73J-H04 srt content-type", ct.includes("x-subrip"), ct);
}

// ═══ TEST-73J-H05: Content-Length ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/audio/test.mp3`);
  const cl = r.headers.get("content-length");
  report("TASK-73J-H05 content-length set", cl === String(KNOWN["audio/test.mp3"].length), `cl=${cl}`);
  await r.arrayBuffer();
}

// ═══ TEST-73J-H06: missing key → 404 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/audio/missing.mp3`);
  report("TASK-73J-H06 missing 404", r.status === 404, `status=${r.status}`);
  const j = await r.json();
  report("TASK-73J-H06 no secrets in body", !/R2_SECRET|R2_ACCESS|test-bucket|test-key/.test(JSON.stringify(j)));
}

// ═══ TEST-73J-H07: traversal key → 400 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/..%2F..%2Fetc%2Fpasswd`);
  report("TASK-73J-H07 traversal rejected 400", r.status === 400 || r.status === 404, `status=${r.status}`);
}

// ═══ TEST-73J-H08: empty key → 400 ═══
{
  // Express may route differently for empty wildcard; test both encoded and raw
  const r = await fetch(`${BASE}/api/storage/r2/`);
  report("TASK-73J-H08 empty key rejected", r.status === 400 || r.status === 404, `status=${r.status}`);
}

// ═══ TEST-73J-H09: Range header → 206 + Content-Range ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/videos/movie.mp4`, {
    headers: { Range: "bytes=0-99" },
  });
  report("TASK-73J-H09 status 206", r.status === 206, `status=${r.status}`);
  const cr = r.headers.get("content-range");
  report("TASK-73J-H09 content-range", cr === `bytes 0-99/${KNOWN["videos/movie.mp4"].length}`, `cr=${cr}`);
  const body = Buffer.from(await r.arrayBuffer());
  report("TASK-73J-H09 body length 100", body.length === 100);
}

// ═══ TEST-73J-H10: Range beyond end → 416 ═══
{
  const total = KNOWN["videos/movie.mp4"].length;
  const r = await fetch(`${BASE}/api/storage/r2/videos/movie.mp4`, {
    headers: { Range: `bytes=${total + 100}-${total + 200}` },
  });
  report("TASK-73J-H10 416 for out-of-range", r.status === 416, `status=${r.status}`);
  const cr = r.headers.get("content-range");
  report("TASK-73J-H10 content-range bytes */total", cr === `bytes */${total}`, `cr=${cr}`);
}

// ═══ TEST-73J-H11: Accept-Ranges header ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/audio/test.mp3`);
  await r.arrayBuffer();
  report("TASK-73J-H11 accept-ranges=bytes", r.headers.get("accept-ranges") === "bytes");
}

// ═══ TEST-73J-H12: local provider rejects /api/storage/r2/ with 404 ═══
{
  setEnv("STORAGE_PROVIDER", "local");
  _resetStorageForTests();
  // build a second app
  const app2 = express();
  app2.use("/api", storageRouter);
  const srv2 = http.createServer(app2);
  await new Promise<void>((r) => srv2.listen(0, "127.0.0.1", () => r()));
  const p2 = (srv2.address() as any).port;
  const r = await fetch(`http://127.0.0.1:${p2}/api/storage/r2/audio/test.mp3`);
  report("TASK-73J-H12 local rejects 404", r.status === 404, `status=${r.status}`);
  srv2.close();
  setEnv("STORAGE_PROVIDER", "r2");
  _resetStorageForTests();
}

server.close();

restoreEnv();
_resetStorageForTests();
console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
