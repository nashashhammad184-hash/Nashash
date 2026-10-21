/**
 * KAYAN-TASK-DEPLOY-19: unit tests for Deepgram endpoint resolver
 * and mock TTS server. No real Deepgram call, no DB, no network to
 * external services.
 */
import http from "node:http";
import { _resolveDeepgramEndpoint } from "../src/lib/productionEngine.ts";

let pass = 0, fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

const OFFICIAL = "https://api.deepgram.com/v1/speak";

// ── 1. Endpoint resolver ─────────────────────────────────────────
{
  const r = _resolveDeepgramEndpoint({} as any);
  report("DEPLOY19-01 no env → official Deepgram", r === OFFICIAL, r);
}
{
  const r = _resolveDeepgramEndpoint({ DEEPGRAM_TTS_ENDPOINT: "" } as any);
  report("DEPLOY19-02 empty env → official", r === OFFICIAL, r);
}
{
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "http://127.0.0.1:9999/" } as any);
  report("DEPLOY19-03 dev + loopback http → override", r === "http://127.0.0.1:9999/", r);
}
{
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "http://localhost:9999/" } as any);
  report("DEPLOY19-04 dev + localhost → override", r === "http://localhost:9999/", r);
}
{
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "http://[::1]:9999/" } as any);
  report("DEPLOY19-05 dev + ::1 → override", r === "http://[::1]:9999/", r);
}
{
  // SAFETY: production must NEVER allow override, even to loopback.
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "production", DEEPGRAM_TTS_ENDPOINT: "http://127.0.0.1:9999/" } as any);
  report("DEPLOY19-06 prod + loopback → OFFICIAL (fail-safe)", r === OFFICIAL, r);
}
{
  // SAFETY: external host must NEVER be allowed, even in dev.
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "https://evil.example.com/" } as any);
  report("DEPLOY19-07 dev + external host → OFFICIAL", r === OFFICIAL, r);
}
{
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "not a url" } as any);
  report("DEPLOY19-08 invalid URL → OFFICIAL", r === OFFICIAL, r);
}
{
  const r = _resolveDeepgramEndpoint({ NODE_ENV: "development", DEEPGRAM_TTS_ENDPOINT: "file:///etc/passwd" } as any);
  report("DEPLOY19-09 non-http scheme → OFFICIAL", r === OFFICIAL, r);
}

// ── 2. Mock TTS server ───────────────────────────────────────────
// Minimal valid MP3 header (ID3 + silent frame). Not a full MP3 but
// enough for buffer/length checks.
const MOCK_MP3 = Buffer.concat([
  Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "binary"),
  Buffer.alloc(2048, 0xff), // padding, so saveAudioBuffer sees size > 0
]);

async function startMock(opts: { failWith?: number } = {}): Promise<{
  url: string; close: () => Promise<void>;
}> {
  const srv = http.createServer((req, res) => {
    if (opts.failWith) {
      res.statusCode = opts.failWith;
      res.end("mock failure");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.end(MOCK_MP3);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const addr = srv.address() as any;
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

// Happy path
{
  const mock = await startMock();
  try {
    const res = await fetch(`${mock.url}?model=test`);
    report("DEPLOY19-10 mock returns 200", res.status === 200, `status=${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    report("DEPLOY19-11 mock returns non-empty body", buf.length > 0, `len=${buf.length}`);
    report("DEPLOY19-12 mock returns audio/mpeg", res.headers.get("content-type") === "audio/mpeg", res.headers.get("content-type") || "");
  } finally { await mock.close(); }
}

// Failure path
{
  const mock = await startMock({ failWith: 500 });
  try {
    const res = await fetch(`${mock.url}?model=test`);
    report("DEPLOY19-13 mock 500 is not ok", !res.ok, `status=${res.status}`);
  } finally { await mock.close(); }
}

// Bind address is loopback only
{
  const mock = await startMock();
  try {
    report("DEPLOY19-14 mock binds 127.0.0.1 only", mock.url.startsWith("http://127.0.0.1:"), mock.url);
  } finally { await mock.close(); }
}

// ── 3. Static: production code still calls official URL when prod ─
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/productionEngine.ts"), "utf-8");
report("DEPLOY19-15 productionEngine exports _resolveDeepgramEndpoint", /export function _resolveDeepgramEndpoint/.test(src));
report("DEPLOY19-16 productionEngine uses const from resolver", /const DEEPGRAM_TTS_ENDPOINT: string = _resolveDeepgramEndpoint\(process\.env\)/.test(src));
report("DEPLOY19-17 official URL constant preserved in resolver", /"https:\/\/api\.deepgram\.com\/v1\/speak"/.test(src));

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
