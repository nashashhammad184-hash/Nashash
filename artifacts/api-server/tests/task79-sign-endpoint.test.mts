import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import storageRouter from "../src/routes/storage";
import { _resetStorageForTests } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TEST_SECRET = "s".repeat(64);
const TEST_TOKEN = "t".repeat(64);
process.env.SESSION_SECRET = TEST_SECRET;
process.env.PRODUCTION_API_TOKEN = TEST_TOKEN;
process.env.NODE_ENV = "development";

// ═══ Setup: local provider (no R2 needed) ═══
process.env.STORAGE_PROVIDER = "local";
_resetStorageForTests();

// Place a fixture in uploads/videos
import fs from "node:fs";
import path from "node:path";
const UPLOADS = path.resolve(process.cwd(), "uploads");
const VID_DIR = path.join(UPLOADS, "videos");
fs.mkdirSync(VID_DIR, { recursive: true });
const testFile = path.join(VID_DIR, "sign-test-79.mp4");
fs.writeFileSync(testFile, Buffer.from("fake-video"));

const CANON_DIR = path.join(UPLOADS, "canonical_faces");
fs.mkdirSync(CANON_DIR, { recursive: true });
const canonFile = path.join(CANON_DIR, "sign-test-79.jpg");
fs.writeFileSync(canonFile, Buffer.from("fake-image"));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", storageRouter);
const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

const authHeaders = { Authorization: `Bearer ${TEST_TOKEN}` };

// ═══ TEST-79S-01: no auth → 401 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=videos/sign-test-79.mp4`);
  report("TASK-79S-01 no auth → 401", r.status === 401, `status=${r.status}`);
}

// ═══ TEST-79S-02: with auth + valid key → 200 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=videos/sign-test-79.mp4`, { headers: authHeaders });
  report("TASK-79S-02 valid → 200", r.status === 200, `status=${r.status}`);
  const j = await r.json();
  report("TASK-79S-02 local URL returned", j.url === "/uploads/videos/sign-test-79.mp4", j.url);
  report("TASK-79S-02 expiresAt null (local)", j.expiresAt === null);
  report("TASK-79S-02 ttl reported", typeof j.ttlSeconds === "number");
}

// ═══ TEST-79S-03: missing key → 400 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign`, { headers: authHeaders });
  report("TASK-79S-03 missing key → 400", r.status === 400, `status=${r.status}`);
}

// ═══ TEST-79S-04: traversal → 400 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=videos/../../etc/passwd`, { headers: authHeaders });
  report("TASK-79S-04 traversal → 400", r.status === 400, `status=${r.status}`);
}

// ═══ TEST-79S-05: canonical_faces → 403 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=canonical_faces/sign-test-79.jpg`, { headers: authHeaders });
  report("TASK-79S-05 canonical_faces → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-79S-06: actors/refs → 403 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=actors/refs/x.jpg`, { headers: authHeaders });
  report("TASK-79S-06 actors/refs → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-79S-07: unknown prefix → 403 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=secrets/leak.txt`, { headers: authHeaders });
  report("TASK-79S-07 unknown prefix → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-79S-08: audio prefix works ═══
{
  fs.writeFileSync(path.join(UPLOADS, "audio", "test-sign.mp3"), Buffer.from("x"));
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=audio/test-sign.mp3`, { headers: authHeaders });
  report("TASK-79S-08 audio prefix allowed", r.status === 200, `status=${r.status}`);
  try { fs.unlinkSync(path.join(UPLOADS, "audio", "test-sign.mp3")); } catch {}
}

// ═══ TEST-79S-09: missing file in local → 404 ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=videos/does-not-exist-79.mp4`, { headers: authHeaders });
  report("TASK-79S-09 missing file → 404", r.status === 404, `status=${r.status}`);
}

// ═══ TEST-79S-10: no leak of secrets in response ═══
{
  const r = await fetch(`${BASE}/api/storage/r2/sign?key=videos/sign-test-79.mp4`, { headers: authHeaders });
  const body = await r.text();
  report("TASK-79S-10 no token leak", !body.includes(TEST_TOKEN));
  report("TASK-79S-10 no secret leak", !body.includes(TEST_SECRET));
}

// ═══ TEST-79S-11: static check — sign uses requireProductionAuth ═══
{
  const src = fs.readFileSync("./src/routes/storage.ts", "utf-8");
  report("TASK-79S-11 requireProductionAuth used", /requireProductionAuth/.test(src));
  report("TASK-79S-11 sign route uses auth middleware", /"\/storage\/r2\/sign",\s*requireProductionAuth/.test(src));
  report("TASK-79S-11 deny list present", /SIGN_DENIED_PREFIXES/.test(src));
  report("TASK-79S-11 allow list present", /SIGN_ALLOWED_PREFIXES/.test(src));
  report("TASK-79S-11 bounded TTL", /SIGN_MAX_TTL_SEC/.test(src));
}

srv.close();
try { fs.unlinkSync(testFile); } catch {}
try { fs.unlinkSync(canonFile); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
