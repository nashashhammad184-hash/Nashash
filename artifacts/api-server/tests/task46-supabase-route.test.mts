/**
 * KAYAN-TASK-46: tests for GET /api/storage/supabase/{*key}.
 *
 * All offline — uses _resetStorageForTests(override) to install a mock
 * "supabase" provider. No network, no real Supabase, no secrets.
 */
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { StorageError } from "../src/lib/storage/types.ts";

let pass = 0;
let fail = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? pass++ : fail++;
};

process.env.PRODUCTION_API_TOKEN = "t".repeat(32);
process.env.SESSION_SECRET = "s".repeat(64);
process.env.NODE_ENV = "development";
const AUTH = "Bearer " + process.env.PRODUCTION_API_TOKEN;

const storageRouterMod = await import("../src/routes/storage.ts");
const storageRouter = storageRouterMod.default;
const indexMod = await import("../src/lib/storage/index.ts");
const _resetStorageForTests = indexMod._resetStorageForTests;

// ── Mock supabase provider WITH getSignedUrl (redirect path) ─────
const MOCK_FILE_BODY = Buffer.from("Hello audio content for tests");
type MockOpts = {
  withSign?: boolean;
  /** undefined → provider has no getSize at all (must trigger 503). */
  getSizeResult?: number | null;
};

function makeMock(opts: MockOpts) {
  const { withSign = false, getSizeResult } = opts;
  const base: any = {
    name: "supabase" as const,
    async write() { return ""; },
    async read(key: string) {
      if (key === "audio/exists.mp3") return MOCK_FILE_BODY;
      throw new StorageError("NOT_FOUND", `not found: ${key}`);
    },
    async exists() { return false; },
    async delete() {},
    async localPath() { return ""; },
    async cleanup() {},
    publicUrl(key: string) { return `/api/storage/supabase/${key}`; },
  };
  if (withSign) {
    base.getSignedUrl = async (key: string, ttl: number) => {
      if (key === "audio/exists.mp3") {
        return { url: `https://signed.supabase.invalid/${key}?ttl=${ttl}`, expiresAt: Date.now() + ttl * 1000 };
      }
      throw new StorageError("NOT_FOUND", `not found: ${key}`);
    };
  }
  if (getSizeResult !== undefined) {
    base.getSize = async () => getSizeResult;
  }
  return base;
}

// ── Express app with the router ──────────────────────────────────
const app = express();
app.use(cookieParser());
app.use("/api", storageRouter);
const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

async function call(path: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${path}`, { redirect: "manual", ...opts });
}

// ── Tests ─────────────────────────────────────────────────────────
_resetStorageForTests(makeMock({ withSign: true }) as any);

{
  // 1. No auth → 401
  const r = await call("/api/storage/supabase/audio/exists.mp3");
  report("TASK46-01 no auth → 401", r.status === 401, `status=${r.status}`);
}

{
  // 2. Wrong Bearer → 401
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: "Bearer wrong" },
  });
  report("TASK46-02 wrong Bearer → 401", r.status === 401, `status=${r.status}`);
}

{
  // 3. Valid auth + existing key → 302 redirect to signed URL
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH },
  });
  const loc = r.headers.get("location") || "";
  report("TASK46-03 valid auth + exists → 302", r.status === 302, `status=${r.status}`);
  report("TASK46-03 Location is signed URL", loc.startsWith("https://signed.supabase.invalid/audio/exists.mp3"), loc.slice(0, 80));
}

{
  // 4. Valid auth + missing key → 404 (mock getSignedUrl throws NOT_FOUND)
  const r = await call("/api/storage/supabase/audio/missing.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK46-04 valid auth + missing → 404", r.status === 404, `status=${r.status}`);
}

{
  // 5. Path traversal → 400
  const r = await call("/api/storage/supabase/..%2F..%2Fetc%2Fpasswd", {
    headers: { Authorization: AUTH },
  });
  report("TASK46-05 path traversal → 400", r.status === 400, `status=${r.status}`);
}

{
  // 6. Leading slash encoded → 400
  const r = await call("/api/storage/supabase/%2Fetc%2Fpasswd", {
    headers: { Authorization: AUTH },
  });
  report("TASK46-06 leading-slash key → 400", r.status === 400, `status=${r.status}`);
}

// ── Fallback path: provider WITHOUT getSignedUrl ────────────────
_resetStorageForTests(makeMock({ withSign: false, getSizeResult: MOCK_FILE_BODY.length }) as any);

{
  // 7. Valid auth, no signer → 200 with body
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH },
  });
  const body = Buffer.from(await r.arrayBuffer()).toString();
  report("TASK46-07 no signer → 200 fallback", r.status === 200, `status=${r.status}`);
  report("TASK46-07 body matches", body === MOCK_FILE_BODY.toString(), `len=${body.length}`);
  report("TASK46-07 Content-Type is audio/mpeg", r.headers.get("content-type") === "audio/mpeg", r.headers.get("content-type") || "");
  report("TASK46-07 Accept-Ranges header present", r.headers.get("accept-ranges") === "bytes");
}

{
  // 8. Range request on fallback → 206 with slice
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH, Range: "bytes=0-4" },
  });
  const buf = Buffer.from(await r.arrayBuffer());
  report("TASK46-08 range → 206", r.status === 206, `status=${r.status}`);
  report("TASK46-08 Content-Range header", (r.headers.get("content-range") || "").startsWith("bytes 0-4/"), r.headers.get("content-range") || "");
  report("TASK46-08 body length = 5", buf.length === 5, `len=${buf.length}`);
  report("TASK46-08 body bytes correct", buf.toString() === MOCK_FILE_BODY.subarray(0, 5).toString(), buf.toString());
}

{
  // 9. Range beyond end → 416
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH, Range: "bytes=9999-10000" },
  });
  report("TASK46-09 range beyond → 416", r.status === 416, `status=${r.status}`);
}

// ── Provider mismatch: name != "supabase" → 404 ─────────────────
{
  const localMock = {
    name: "local" as const,
    async write() { return ""; },
    async read() { return Buffer.from(""); },
    async exists() { return false; },
    async delete() {},
    async localPath() { return ""; },
    async cleanup() {},
    publicUrl(key: string) { return `/uploads/${key}`; },
  };
  _resetStorageForTests(localMock as any);
  const r = await call("/api/storage/supabase/audio/x.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK46-10 provider != supabase → 404", r.status === 404, `status=${r.status}`);
}

// ── TASK-48: fallback size cap ─────────────────────────────────
{
  // Provider has NO getSize method → must refuse in-memory fallback.
  const mockNoSize: any = {
    name: "supabase" as const,
    async write() { return ""; },
    async read() { return Buffer.from(""); },
    async exists() { return false; },
    async delete() {},
    async localPath() { return ""; },
    async cleanup() {},
    publicUrl(key: string) { return `/api/storage/supabase/${key}`; },
    // no getSignedUrl, no getSize
  };
  _resetStorageForTests(mockNoSize);
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK48-01 no signer + no getSize → 503", r.status === 503, `status=${r.status}`);
}

{
  // Provider has getSize but returns null (unknown) → must refuse.
  _resetStorageForTests(makeMock({ withSign: false, getSizeResult: null }) as any);
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK48-02 no signer + getSize null → 503", r.status === 503, `status=${r.status}`);
}

{
  // Provider has getSize > 10 MB → must refuse.
  _resetStorageForTests(makeMock({ withSign: false, getSizeResult: 15 * 1024 * 1024 }) as any);
  const r = await call("/api/storage/supabase/audio/exists.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK48-03 no signer + getSize >10MB → 503", r.status === 503, `status=${r.status}`);
}

{
  // Malformed URI (%ZZ) → 400, not 500.
  _resetStorageForTests(makeMock({ withSign: true }) as any);
  const r = await call("/api/storage/supabase/audio%ZZbad.mp3", {
    headers: { Authorization: AUTH },
  });
  report("TASK48-04 malformed URI %ZZ → 400 not 500", r.status === 400, `status=${r.status}`);
}

_resetStorageForTests();
srv.close();

console.log(`SUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
