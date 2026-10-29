import "./loadEnv";
import { assertEnvOrThrow } from "./lib/validateEnv";

// KAYAN-7.1: assign role unconditionally — never rely on env being set manually.
// health.ts reads SERVICE_ROLE at request time; this guarantees consistency
// with the assertEnvOrThrow() role below.
process.env.SERVICE_ROLE = "api";

// KAYAN-7: fail-fast on missing env for this role (api).
// Throws before Express binds — no silent QUEUED-then-FAILED cycles.
const __envCheck = assertEnvOrThrow("api");
export const envCheck = __envCheck;
import express from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { rateLimiterShield, originGuard } from "./lib/securityMiddleware";
import router from "./routes/index";
// KAYAN-TASK-79: cookie-based session endpoints.
import authRouter from "./routes/auth";
import { startProductionWorker } from "./lib/productionEngine";

const app = express();
// KAYAN-PROXY-FIX: Northflank sits behind a load balancer that sets
// X-Forwarded-For. Express must trust the first proxy, otherwise
// express-rate-limit throws ValidationError and closes the connection (HTTP 000).
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;

// KAYAN-CORS-01: strict allow-list in production. Dev falls back to permissive.
const NODE_ENV_VAL = (process.env.NODE_ENV || "").toLowerCase();
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

const corsOptions: Parameters<typeof cors>[0] = {
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
if (NODE_ENV_VAL === "production") {
  corsOptions.origin = (origin, cb) => {
    // Same-origin / server-to-server (no Origin header) is allowed.
    if (!origin) return cb(null, true);
    if (CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false); // origin not allowed — no CORS headers emitted
  };
} else {
  // Development: permissive.
  corsOptions.origin = true;
}
app.use(cors(corsOptions));

app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
// KAYAN-TASK-79: parse session cookies before /api routes.
app.use(cookieParser());
// KAYAN-TASK-79: auth endpoints are public (they ARE the auth mechanism).
// KAYAN-TASK-80B: originGuard before /api so cookie-authenticated
// state-changing requests are CSRF-protected centrally.
app.use("/api", originGuard);
app.use("/api", rateLimiterShield, authRouter);
app.use("/api", rateLimiterShield, router);

const STORAGE_ROOT = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}
app.use("/uploads", express.static(STORAGE_ROOT));

const studioPublicPath = path.resolve(process.cwd(), "artifacts/studio/dist/public");
const sandboxPublicPath = path.resolve(process.cwd(), "artifacts/mockup-sandbox/dist/public");

if (fs.existsSync(sandboxPublicPath)) {
  app.use("/mockup-assets", express.static(path.join(sandboxPublicPath, "assets")));
  app.use("/mockup", express.static(sandboxPublicPath));
}
if (fs.existsSync(studioPublicPath)) {
  app.use("/assets", express.static(path.join(studioPublicPath, "assets")));
  app.use(express.static(studioPublicPath));
}

app.get("/*splat", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "API Route not found" });
  }
  if (req.path.startsWith("/mockup") && fs.existsSync(path.join(sandboxPublicPath, "index.html"))) {
    return res.sendFile(path.join(sandboxPublicPath, "index.html"));
  }
  const studioIndex = path.join(studioPublicPath, "index.html");
  if (fs.existsSync(studioIndex)) {
    return res.sendFile(studioIndex);
  }
  res.status(200).send("Kayan AI Studio is online.");
});


// KAYAN-ERR-HANDLER: catch unhandled middleware errors (e.g. rate-limit
// ValidationError) so the connection never silently closes (HTTP 000).
app.use((err: any, _req: any, res: any, next: any) => {
  if (res.headersSent) return next(err);
  console.error("[kayan-error]", err?.message || err);
  res.status(500).json({
    error: "internal_error",
    message: err?.message ? String(err.message).slice(0, 200) : "unknown",
  });
});

app.listen(port, () => {
  console.log(`🎬 Cinematic Production Server running with CORS enabled on port ${port}`);
  // KAYAN-TASK-DEPLOY-04: allow fully disabling the in-process worker for
  // deployments that must run API-only (e.g., Render Free where GPU worker
  // is unavailable). Without this gate, the worker would still create
  // workerInterval and start polling, even with NASHASH_DISABLE_AUTO_WORKER=1.
  if (process.env.NASHASH_DISABLE_AUTO_WORKER === "1") {
    console.log("[worker] auto-worker disabled by NASHASH_DISABLE_AUTO_WORKER=1 — API-only mode");
  } else {
    startProductionWorker();
  }
});
