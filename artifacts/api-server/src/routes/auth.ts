/**
 * KAYAN-TASK-79: cookie-based session authentication endpoints.
 *
 *   POST /api/auth/login    → verify PRODUCTION_API_TOKEN → set HttpOnly cookie
 *   POST /api/auth/logout   → clear cookie
 *   GET  /api/auth/session  → report authentication state (no secrets)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  setSessionCookie,
  clearSessionCookie,
  readSession,
  constantTimeTokenEqual,
} from "../lib/auth";
// KAYAN-TASK-80B: shared origin check.
import { isOriginAllowed } from "../lib/securityMiddleware";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// KAYAN-TASK-DEPLOY-15: tighten and harden login rate limits.
//
// 1) Per-IP limiter (10 attempts / 15 min). Uses express-rate-limit v8's
//    `limit` (the modern alias for the deprecated `max`). On Render the
//    underlying req.ip may rotate between requests if the LB doesn't forward
//    a stable X-Forwarded-For header, so this limiter alone is best-effort.
//
// 2) Global circuit breaker (60 attempts / 1 min, keyed to a fixed string).
//    This caps the total number of login attempts regardless of source IP
//    rotation. It fires before any external cost or CPU load from repeated
//    constant-time token comparison. Defense-in-depth against brute force
//    that rotates IPs.
//
// `validate: false` avoids a runtime validation check in v8 that can
// silently skip the limiter when `trust proxy` is configured a certain
// way. We accept the trade-off deliberately.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: "Too many login attempts. Try again later." },
});

const globalLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  validate: false,
  keyGenerator: () => "global-login",
  message: { error: "Too many login attempts globally. Try again later." },
});

// KAYAN-TASK-80B: login/logout accept no-Origin (CLI, server-to-server)
// as well as same-origin and allow-listed origins. Unlike generic
// state-changing routes, login MUST work from non-browser clients.
function loginOriginOk(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // no ambient credentials → not CSRF
  return isOriginAllowed(req);
}

router.post("/auth/login", loginLimiter, globalLoginLimiter, (req: Request, res: Response): void => {
  if (!loginOriginOk(req)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  const expected = process.env.PRODUCTION_API_TOKEN?.trim();
  if (!expected) {
    res.status(503).json({ error: "PRODUCTION_AUTH_NOT_CONFIGURED" });
    return;
  }
  const body = req.body || {};
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  if (!constantTimeTokenEqual(token, expected)) {
    logger.warn({ ip: req.ip }, "auth.login failed: invalid token");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  let expiresAt: number;
  try {
    expiresAt = setSessionCookie(res);
  } catch (e: any) {
    logger.error({ err: e?.message }, "auth.login: session creation failed");
    res.status(500).json({ error: "Session subsystem unavailable" });
    return;
  }
  logger.info({ ip: req.ip, expiresAt }, "auth.login success");
  res.json({ success: true, expiresAt });
});

router.post("/auth/logout", (req: Request, res: Response): void => {
  if (!loginOriginOk(req)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get("/auth/session", (req: Request, res: Response): void => {
  const s = readSession(req);
  res.json({
    authenticated: s.authenticated,
    source: s.authenticated ? s.source : null,
    expiresAt: s.payload?.exp ?? null,
  });
});

export default router;
