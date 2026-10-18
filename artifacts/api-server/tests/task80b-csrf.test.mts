import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { originGuard } from "../src/lib/securityMiddleware";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/lib/auth";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Minimal env
process.env.SESSION_SECRET = "x".repeat(64);
process.env.NODE_ENV = "development";
process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example.com";

// Build minimal app with originGuard + mock handlers
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", originGuard);
app.post("/api/dummy", (req, res) => res.json({ ok: true }));
app.patch("/api/dummy", (req, res) => res.json({ ok: true }));
app.delete("/api/dummy", (req, res) => res.json({ ok: true }));
app.get("/api/dummy", (req, res) => res.json({ ok: true }));

const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;
const HOST = `127.0.0.1:${port}`;

// Create a valid session cookie for testing
const { token: sessionToken } = createSessionToken();
const validCookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;

// ═══ TEST-80B-01: POST with cookie but no Origin → 403 ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-01 cookie+POST no Origin → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-80B-02: POST with cookie + bad Origin → 403 ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, Origin: "https://evil.example.com", "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-02 cookie+POST bad Origin → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-80B-03: POST with cookie + allowed Origin → 200 ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, Origin: "https://allowed.example.com", "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-03 cookie+POST allowed Origin → 200", r.status === 200, `status=${r.status}`);
}

// ═══ TEST-80B-04: PATCH with cookie + no Origin → 403 ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "PATCH",
    headers: { Cookie: validCookie, "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-04 cookie+PATCH no Origin → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-80B-05: DELETE with cookie + no Origin → 403 ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "DELETE",
    headers: { Cookie: validCookie },
  });
  report("TASK-80B-05 cookie+DELETE no Origin → 403", r.status === 403, `status=${r.status}`);
}

// ═══ TEST-80B-06: POST with Bearer (no cookie) → 200 (no CSRF surface) ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-06 Bearer+POST no cookie → 200", r.status === 200, `status=${r.status}`);
}

// ═══ TEST-80B-07: POST without any auth → 200 (guard only fires on cookie) ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-07 no auth no cookie → 200 (guard skips)", r.status === 200, `status=${r.status}`);
}

// ═══ TEST-80B-08: GET with cookie but no Origin → 200 (not state-changing) ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    headers: { Cookie: validCookie },
  });
  report("TASK-80B-08 GET cookie no Origin → 200", r.status === 200, `status=${r.status}`);
}

// ═══ TEST-80B-09: Same-origin POST with cookie → 200 (host matches) ═══
{
  process.env.CORS_ALLOWED_ORIGINS = ""; // switch to same-origin mode
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, Origin: BASE, "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-09 same-origin POST → 200", r.status === 200, `status=${r.status}`);
  process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example.com";
}

// ═══ TEST-80B-10: Same-origin POST with cookie (same-host check with ports) ═══
{
  process.env.CORS_ALLOWED_ORIGINS = "";
  // Use a different host that isn't the same → 403
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, Origin: "http://localhost:9999", "Content-Type": "application/json" },
    body: "{}",
  });
  report("TASK-80B-10 different host → 403", r.status === 403, `status=${r.status}`);
  process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example.com";
}

// ═══ TEST-80B-11: Static — index.ts wires originGuard ═══
{
  const fs = await import("node:fs");
  const idx = fs.readFileSync("./src/index.ts", "utf-8");
  report("TASK-80B-11 imports originGuard", /originGuard/.test(idx));
  report("TASK-80B-11 app.use originGuard", /app\.use\("\/api",\s*originGuard\)/.test(idx));
}

// ═══ TEST-80B-12: Static — securityMiddleware exports originGuard ═══
{
  const fs = await import("node:fs");
  const sm = fs.readFileSync("./src/lib/securityMiddleware.ts", "utf-8");
  report("TASK-80B-12 exports originGuard", /export function originGuard/.test(sm));
  report("TASK-80B-12 has STATE_CHANGING_METHODS", /STATE_CHANGING_METHODS/.test(sm));
  report("TASK-80B-12 checks SESSION_COOKIE_NAME", /SESSION_COOKIE_NAME/.test(sm));
}

// ═══ TEST-80B-13: Static — auth.ts uses shared isOriginAllowed ═══
{
  const fs = await import("node:fs");
  const authSrc = fs.readFileSync("./src/routes/auth.ts", "utf-8");
  report("TASK-80B-13 imports isOriginAllowed", /import { isOriginAllowed }/.test(authSrc));
  report("TASK-80B-13 login accepts no-Origin (CLI)", /if \(!origin\) return true;/.test(authSrc));
}

// ═══ TEST-80B-14: Origin missing entirely → guard fires (has cookie) ═══
{
  const r = await fetch(`${BASE}/api/dummy`, {
    method: "POST",
    headers: { Cookie: validCookie, "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json();
  report("TASK-80B-14 error message is descriptive", typeof j.error === "string" && j.error.length > 20);
  report("TASK-80B-14 no secret leak", !JSON.stringify(j).includes(process.env.SESSION_SECRET!));
}

srv.close();
console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
