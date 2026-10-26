/**
 * KAYAN-GUARD-03: verify that missing SESSION_SECRET disables cookie sessions
 * ONLY, and never weakens Bearer auth or fails-open any protected route.
 *
 * Run: pnpm exec tsx tests/guard-03-auth-isolation.test.mts
 */
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Force the fail-closed code path: no SESSION_SECRET.
delete process.env.SESSION_SECRET;
process.env.PRODUCTION_API_TOKEN = "b".repeat(64);
process.env.NODE_ENV = "production"; // stricter: no dev bypass either
delete process.env.ALLOW_DEV_PRODUCTION_BYPASS;

const { default: authRouter } = await import("../src/routes/auth");
const { requireProductionAuth } = await import("../src/lib/securityMiddleware");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRouter);
app.get("/api/protected", requireProductionAuth, (_req, res) => {
  res.json({ ok: true });
});

const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

// ═══ G3-01: login without SESSION_SECRET → 500, no cookie issued ═══
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: process.env.PRODUCTION_API_TOKEN }),
  });
  const sc = r.headers.get("set-cookie") || "";
  report("G3-01 login without SESSION_SECRET → 500", r.status === 500, `status=${r.status}`);
  report("G3-01 no cookie issued", !sc.includes("kayan_session="), sc.slice(0, 60));
  const body = await r.text();
  report("G3-01 response does not leak token", !body.includes(process.env.PRODUCTION_API_TOKEN!));
}

// ═══ G3-02: Bearer auth still works when SESSION_SECRET absent ═══
{
  const r = await fetch(`${BASE}/api/protected`, {
    headers: { Authorization: `Bearer ${process.env.PRODUCTION_API_TOKEN}` },
  });
  report("G3-02 Bearer still grants access", r.status === 200, `status=${r.status}`);
}

// ═══ G3-03: no auth at all → still 401 (fail-closed) ═══
{
  const r = await fetch(`${BASE}/api/protected`);
  report("G3-03 no auth → 401 (fail-closed)", r.status === 401, `status=${r.status}`);
}

// ═══ G3-04: forged cookie does NOT bypass when SESSION_SECRET absent ═══
{
  const r = await fetch(`${BASE}/api/protected`, {
    headers: { Cookie: "kayan_session=forged-payload.forged-sig" },
  });
  report("G3-04 forged cookie rejected", r.status === 401, `status=${r.status}`);
}

// ═══ G3-05: wrong Bearer → 401 ═══
{
  const r = await fetch(`${BASE}/api/protected`, {
    headers: { Authorization: "Bearer wrong-token" },
  });
  report("G3-05 wrong Bearer → 401", r.status === 401, `status=${r.status}`);
}

srv.close();
console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
