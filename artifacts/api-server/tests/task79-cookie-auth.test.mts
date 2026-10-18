import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../src/routes/auth";
import { _resetStorageForTests } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Set up env for tests (SESSION_SECRET + PRODUCTION_API_TOKEN)
const TEST_SECRET = "a".repeat(64);
const TEST_TOKEN = "b".repeat(64);
process.env.SESSION_SECRET = TEST_SECRET;
process.env.PRODUCTION_API_TOKEN = TEST_TOKEN;
process.env.NODE_ENV = "development"; // not production for cookie testing
process.env.CORS_ALLOWED_ORIGINS = "";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRouter);
const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

// ═══ TEST-79-01: session status unauthenticated ═══
{
  const r = await fetch(`${BASE}/api/auth/session`);
  const j = await r.json();
  report("TASK-79-01 unauthenticated session", j.authenticated === false, JSON.stringify(j));
}

// ═══ TEST-79-02: login with wrong token → 401 ═══
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "wrong-token" }),
  });
  report("TASK-79-02 wrong token → 401", r.status === 401, `status=${r.status}`);
  const body = await r.text();
  report("TASK-79-02 no token leaked in error", !body.includes(TEST_TOKEN) && !body.includes("wrong-token"));
}

// ═══ TEST-79-03: login with missing token → 400 ═══
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  report("TASK-79-03 missing token → 400", r.status === 400, `status=${r.status}`);
}

// ═══ TEST-79-04: login with correct token → 200 + HttpOnly cookie ═══
let sessionCookie = "";
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
  report("TASK-79-04 correct token → 200", r.status === 200, `status=${r.status}`);
  const sc = r.headers.get("set-cookie") || "";
  report("TASK-79-04 Set-Cookie present", sc.includes("kayan_session="), sc.slice(0, 60));
  report("TASK-79-04 HttpOnly flag", /HttpOnly/i.test(sc));
  report("TASK-79-04 SameSite=Lax", /SameSite=Lax/i.test(sc));
  report("TASK-79-04 Path=/", /Path=\//i.test(sc));
  // extract cookie value for subsequent requests
  const m = /kayan_session=([^;]+)/.exec(sc);
  if (m) sessionCookie = `kayan_session=${m[1]}`;
  const body = await r.json();
  report("TASK-79-04 response does not leak token", !JSON.stringify(body).includes(TEST_TOKEN));
}

// ═══ TEST-79-05: session check with valid cookie ═══
{
  const r = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: sessionCookie },
  });
  const j = await r.json();
  report("TASK-79-05 authenticated via cookie", j.authenticated === true);
  report("TASK-79-05 source=cookie", j.source === "cookie");
  report("TASK-79-05 expiresAt set", typeof j.expiresAt === "number" && j.expiresAt > Date.now());
  report("TASK-79-05 response no secrets", !JSON.stringify(j).includes(TEST_TOKEN) && !JSON.stringify(j).includes(TEST_SECRET));
}

// ═══ TEST-79-06: session check with forged cookie → not authenticated ═══
{
  const forged = "kayan_session=Zm9yZ2Vk.Zm9yZ2Vk";
  const r = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: forged },
  });
  const j = await r.json();
  report("TASK-79-06 forged cookie rejected", j.authenticated === false);
}

// ═══ TEST-79-07: session check with tampered payload → not authenticated ═══
{
  // Construct: valid signature but manipulated payload is impossible without secret.
  // Instead: valid payload, bad signature
  const badSig = "kayan_session=" + Buffer.from(JSON.stringify({iat:Date.now(),exp:Date.now()+3600_000,v:1})).toString("base64").replace(/=/g,"") + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const r = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: badSig } });
  const j = await r.json();
  report("TASK-79-07 bad signature rejected", j.authenticated === false);
}

// ═══ TEST-79-08: logout clears cookie ═══
{
  const r = await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: BASE },
  });
  report("TASK-79-08 logout 200", r.status === 200);
  const sc = r.headers.get("set-cookie") || "";
  report("TASK-79-08 clear-cookie issued", /kayan_session=;/.test(sc) || /Expires=Thu, 01 Jan 1970/i.test(sc));
}

// ═══ TEST-79-09: Origin rejection ═══
{
  process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example.com";
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
  report("TASK-79-09 bad Origin → 403", r.status === 403, `status=${r.status}`);
  process.env.CORS_ALLOWED_ORIGINS = "";
}

// ═══ TEST-79-10: Origin allowed ═══
{
  process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example.com";
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://allowed.example.com" },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
  report("TASK-79-10 allowed Origin passes", r.status === 200, `status=${r.status}`);
  process.env.CORS_ALLOWED_ORIGINS = "";
}

// ═══ TEST-79-11: expiresAt is bounded (TTL) ═══
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
  const j = await r.json();
  const ttl = j.expiresAt - Date.now();
  report("TASK-79-11 TTL ~12h", ttl > 11 * 3600_000 && ttl < 13 * 3600_000, `${Math.round(ttl/3600_000)}h`);
}

// ═══ TEST-79-12: readSession exports work ═══
{
  const { readSession, createSessionToken, verifySessionToken, constantTimeTokenEqual } = await import("../src/lib/auth");
  const { token, expiresAt } = createSessionToken(60_000);
  const p = verifySessionToken(token);
  report("TASK-79-12 create + verify round-trip", !!p && Math.abs(p.exp - expiresAt) < 1000);
  report("TASK-79-12 tampered token rejected", verifySessionToken(token.slice(0, -3) + "AAA") === null);
  report("TASK-79-12 constantTimeTokenEqual positive", constantTimeTokenEqual("abc", "abc") === true);
  report("TASK-79-12 constantTimeTokenEqual negative", constantTimeTokenEqual("abc", "abd") === false);
}

// ═══ TEST-79-13: static — index.ts wires authRouter and cookieParser ═══
{
  const fs = await import("node:fs");
  const idx = fs.readFileSync("./src/index.ts", "utf-8");
  report("TASK-79-13 cookieParser imported", /import cookieParser/.test(idx));
  report("TASK-79-13 cookieParser() applied", /app\.use\(cookieParser\(\)\)/.test(idx));
  report("TASK-79-13 authRouter mounted", /authRouter/.test(idx));
}

// ═══ TEST-79-14: static — securityMiddleware accepts session ═══
{
  const fs = await import("node:fs");
  const sm = fs.readFileSync("./src/lib/securityMiddleware.ts", "utf-8");
  report("TASK-79-14 imports readSession", /readSession/.test(sm));
  report("TASK-79-14 uses session first", /const session = readSession\(req\)/.test(sm));
  report("TASK-79-14 no legacy Bearer-only path", !/Unauthorized: invalid production token/.test(sm));
}

// ═══ TEST-79-15: PRODUCTION_API_TOKEN not in cookie value ═══
{
  const { createSessionToken } = await import("../src/lib/auth");
  const { token } = createSessionToken();
  report("TASK-79-15 token not in cookie", !token.includes(TEST_TOKEN));
  report("TASK-79-15 session has structure payload.sig", token.includes(".") && token.length > 40);
}

srv.close();
console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
