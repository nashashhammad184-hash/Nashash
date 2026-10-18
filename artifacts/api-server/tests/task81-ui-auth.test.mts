import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../src/routes/auth";
import storageRouter from "../src/routes/storage";
import { _resetStorageForTests } from "../src/lib/storage/index";
import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Env
process.env.SESSION_SECRET = "k".repeat(64);
process.env.PRODUCTION_API_TOKEN = "tk".repeat(32);
process.env.NODE_ENV = "development";
process.env.CORS_ALLOWED_ORIGINS = "";
process.env.STORAGE_PROVIDER = "local";
_resetStorageForTests();

// Fixture in uploads
const UPLOADS = path.resolve(process.cwd(), "uploads");
const VID_DIR = path.join(UPLOADS, "videos");
fs.mkdirSync(VID_DIR, { recursive: true });
const fixture = path.join(VID_DIR, "task81-sign.mp4");
fs.writeFileSync(fixture, Buffer.from("task81-fake-mp4"));

// App
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRouter);
app.use("/api", storageRouter);

const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const BASE = `http://127.0.0.1:${port}`;

// ═══ TEST-81-01: keyFromStorageUrl parsing ═══
{
  const mod = await import("../../artifacts/studio/src/lib/auth-client.ts").catch(() => null);
  // Studio file is TS with JSX-free pure helpers, should import as .ts.
  // If import path fails, fall back to a local copy check.
  const { keyFromStorageUrl } = mod ?? {};
  if (typeof keyFromStorageUrl !== "function") {
    // Pure-function check via source text
    const src = fs.readFileSync("../../artifacts/studio/src/lib/auth-client.ts", "utf-8");
    report("TASK-81-01 keyFromStorageUrl defined in source", /export function keyFromStorageUrl/.test(src));
    report("TASK-81-01 handles /uploads/", /url\.startsWith\("\/uploads\/"\)/.test(src));
    report("TASK-81-01 handles /api\/storage\/r2\/", /url\.startsWith\("\/api\/storage\/r2\/"\)/.test(src));
  } else {
    report("TASK-81-01 parses /uploads/", keyFromStorageUrl("/uploads/videos/x.mp4") === "videos/x.mp4");
    report("TASK-81-01 parses /api/storage/r2/", keyFromStorageUrl("/api/storage/r2/audio/y.mp3") === "audio/y.mp3");
    report("TASK-81-01 returns null for foreign URL", keyFromStorageUrl("https://evil.com/x.mp4") === null);
    report("TASK-81-01 null input", keyFromStorageUrl(null) === null);
  }
}

// ═══ TEST-81-02: login → session → sign flow (cookie jar simulation) ═══
{
  // 1. login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: process.env.PRODUCTION_API_TOKEN }),
  });
  report("TASK-81-02 login success", loginRes.status === 200, `status=${loginRes.status}`);
  const sc = loginRes.headers.get("set-cookie") || "";
  const m = /kayan_session=([^;]+)/.exec(sc);
  report("TASK-81-02 cookie present", !!m);
  const cookie = m ? `kayan_session=${m[1]}` : "";

  // 2. session
  const sessRes = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie } });
  const sessJ = await sessRes.json();
  report("TASK-81-02 session authenticated", sessJ.authenticated === true);

  // 3. sign
  const signRes = await fetch(
    `${BASE}/api/storage/r2/sign?key=${encodeURIComponent("videos/task81-sign.mp4")}`,
    { headers: { Cookie: cookie } },
  );
  report("TASK-81-02 sign 200", signRes.status === 200, `status=${signRes.status}`);
  const signJ = await signRes.json();
  report("TASK-81-02 sign returns local URL", signJ.url === "/uploads/videos/task81-sign.mp4", signJ.url);

  // 4. sign denied prefix
  const deniedRes = await fetch(
    `${BASE}/api/storage/r2/sign?key=${encodeURIComponent("canonical_faces/x.jpg")}`,
    { headers: { Cookie: cookie } },
  );
  report("TASK-81-02 sign denied prefix → 403", deniedRes.status === 403, `status=${deniedRes.status}`);

  // 5. sign without auth → 401
  const noAuthRes = await fetch(`${BASE}/api/storage/r2/sign?key=videos/task81-sign.mp4`);
  report("TASK-81-02 sign without auth → 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

  // 6. logout
  const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: BASE },
  });
  report("TASK-81-02 logout 200", logoutRes.status === 200);
  const scClear = logoutRes.headers.get("set-cookie") || "";
  report("TASK-81-02 logout clears cookie", /kayan_session=;/.test(scClear) || /Expires=Thu, 01 Jan 1970/i.test(scClear));
}

// ═══ TEST-81-03: static — AuthGate wired into App ═══
{
  const appSrc = fs.readFileSync("../../artifacts/studio/src/App.tsx", "utf-8");
  report("TASK-81-03 AuthGate imported", /import { AuthGate }/.test(appSrc));
  report("TASK-81-03 AuthGate wraps StudioLayout", /<AuthGate>[\s\S]{0,200}<StudioLayout>/.test(appSrc));
}

// ═══ TEST-81-04: static — login-modal security ═══
{
  const src = fs.readFileSync("../../artifacts/studio/src/components/auth/login-modal.tsx", "utf-8");
  report("TASK-81-04 no localStorage usage", !/localStorage\.(get|set|remove|clear)/.test(src));
  report("TASK-81-04 no sessionStorage usage", !/sessionStorage\.(get|set|remove|clear)/.test(src));
  report("TASK-81-04 password input type", /type="password"/.test(src));
  report("TASK-81-04 clears token after submit", /setToken\(""\)/.test(src));
}

// ═══ TEST-81-05: static — auth-client security ═══
{
  const src = fs.readFileSync("../../artifacts/studio/src/lib/auth-client.ts", "utf-8");
  report("TASK-81-05 no localStorage usage", !/localStorage\.(get|set|remove|clear)/.test(src));
  report("TASK-81-05 no sessionStorage usage", !/sessionStorage\.(get|set|remove|clear)/.test(src));
  report("TASK-81-05 uses credentials same-origin", /credentials:\s*"same-origin"/.test(src));
  report("TASK-81-05 encodes key", /encodeURIComponent\(key\)/.test(src));
}

// ═══ TEST-81-06: static — video-player-panel retry + credentials ═══
{
  const src = fs.readFileSync("../../artifacts/studio/src/components/project/tabs/video-player-panel.tsx", "utf-8");
  report("TASK-81-06 imports fetchSignedUrl", /fetchSignedUrl/.test(src));
  report("TASK-81-06 imports keyFromStorageUrl", /keyFromStorageUrl/.test(src));
  report("TASK-81-06 has retriedRef", /retriedRef/.test(src));
  report("TASK-81-06 retries exactly once", /retriedRef\.current\s*=\s*true[\s\S]{0,200}if \(!retriedRef\.current\)/.test(src) || /if \(retriedRef\.current\) return;/.test(src));
  report("TASK-81-06 uses credentials same-origin", /credentials:\s*"same-origin"/.test(src));
  report("TASK-81-06 playableUrl separate from videoUrl", /playableUrl/.test(src));
}

// ═══ TEST-81-07: local provider path unaffected ═══
{
  const src = fs.readFileSync("../../artifacts/studio/src/components/project/tabs/video-player-panel.tsx", "utf-8");
  report("TASK-81-07 /uploads passthrough", /startsWith\("\/uploads\/"\)/.test(src));
}

srv.close();
try { fs.unlinkSync(fixture); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
