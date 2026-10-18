import { type Request, type Response, type NextFunction } from "express";
import net from "node:net";
// KAYAN-TASK-79: session cookie support.
import { readSession, SESSION_COOKIE_NAME } from "./auth";

// ─────────────────────────────────────────────────────────────────────
// 1. SSRF protection — strict validation for USER-CONTROLLED proxy URLs.
//    This is applied ONLY to user-provided URLs (e.g. /video/stream?url=...).
//    Internal service calls (e.g. KayanGPU worker via GPU_WORKER_URL) bypass
//    this function by design — they use server-configured env values, not
//    user input, and must remain reachable on localhost / private networks.
// ─────────────────────────────────────────────────────────────────────
const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true;                           // 0.0.0.0/8
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // loopback
  if (a === 169 && b === 254) return true;            // link-local + AWS/GCP metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64.0.0/10
  if (a >= 224) return true;                          // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80")) return true;                         // link-local
  if (lower.startsWith("::ffff:")) {                                 // IPv4-mapped
    return isPrivateIPv4(lower.replace("::ffff:", ""));
  }
  return false;
}

export function validateProxyUrl(urlStr: string): boolean {
  try {
    if (!urlStr || typeof urlStr !== "string") return false;
    const url = new URL(urlStr);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      console.warn(`[SSRF Alert]: Blocked non-HTTP protocol: ${url.protocol}`);
      return false;
    }
    if (url.username || url.password) {
      console.warn(`[SSRF Alert]: Blocked URL with embedded credentials`);
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (FORBIDDEN_HOSTS.has(hostname)) {
      console.warn(`[SSRF Alert]: Blocked forbidden host: ${hostname}`);
      return false;
    }

    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4 && isPrivateIPv4(hostname)) {
      console.warn(`[SSRF Alert]: Blocked private IPv4: ${hostname}`);
      return false;
    }
    if (ipVersion === 6 && isPrivateIPv6(hostname)) {
      console.warn(`[SSRF Alert]: Blocked private IPv6: ${hostname}`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. Production auth — enforced only when PRODUCTION_API_TOKEN is set.
//    If the token is not configured, requests pass through (safe default
//    for dev / current UI). When set, Bearer <token> is mandatory and the
//    value is compared against the env var — never hard-coded.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// 2. Production auth — KAYAN-TASK-12 (fail-closed).
//
//    Policy:
//      - If PRODUCTION_API_TOKEN is set → require a matching Bearer token.
//        Wrong/missing token → 401. Never logged. Never sent to frontend.
//      - If PRODUCTION_API_TOKEN is NOT set:
//          * In production (NODE_ENV !== "development") → FAIL CLOSED with 503.
//          * In development → bypass ONLY when explicitly enabled via
//            ALLOW_DEV_PRODUCTION_BYPASS=true. Otherwise → 503.
//
//    There is no silent pass-through anymore. Bypass is explicit + dev-only.
// ─────────────────────────────────────────────────────────────────────
export function requireProductionAuth(req: Request, res: Response, next: NextFunction): void {
  // KAYAN-TASK-79: prefer a valid session cookie. Fall back to Bearer token
  // for server-to-server and CLI use. Fail-closed otherwise.
  const session = readSession(req);
  if (session.authenticated) {
    next();
    return;
  }

  const expectedToken = process.env.PRODUCTION_API_TOKEN?.trim();
  if (!expectedToken) {
    const isDev = (process.env.NODE_ENV || "").toLowerCase() === "development";
    const devBypass = (process.env.ALLOW_DEV_PRODUCTION_BYPASS || "").toLowerCase() === "true";
    if (isDev && devBypass) {
      next();
      return;
    }
    res.status(503).json({
      error: "PRODUCTION_AUTH_NOT_CONFIGURED",
      message:
        "Production endpoints are disabled: PRODUCTION_API_TOKEN is not set. " +
        "Set it in production, or (development only) set NODE_ENV=development and ALLOW_DEV_PRODUCTION_BYPASS=true.",
    });
    return;
  }
  res.status(401).json({ error: "Unauthorized: sign in or provide a Bearer token." });
}
// ─────────────────────────────────────────────────────────────────────
// 3. Rate limiter shield (unchanged)
// ─────────────────────────────────────────────────────────────────────
const requestTracker = new Map<string, { count: number; resetTime: number }>();

export function rateLimiterShield(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown_ip";
  const now = Date.now();
  const track = requestTracker.get(ip);
  if (!track || now > track.resetTime) {
    requestTracker.set(ip, { count: 1, resetTime: now + 60000 });
  } else {
    track.count++;
    if (track.count > 100) {
      res.status(429).json({ error: "Too many requests. Production Rate-limit shield active." });
      return;
    }
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────
// KAYAN-TASK-80B: CSRF protection for cookie-authenticated requests.
//
// Policy: for state-changing methods (POST/PATCH/PUT/DELETE) that carry a
// session cookie, require a valid Origin header matching either the explicit
// allow-list (CORS_ALLOWED_ORIGINS) or the same host as the request.
//
// Requests WITHOUT a session cookie are unaffected — Bearer-authenticated
// server-to-server calls (CLI, automation) have no ambient credentials and
// therefore no CSRF surface.
// ─────────────────────────────────────────────────────────────────────
const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function readAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== "string") return false;
  const allowed = readAllowedOrigins();
  if (allowed.length > 0) {
    return allowed.includes(origin);
  }
  // No allow-list configured → same-origin only.
  const host = req.headers.host;
  if (!host) return false;
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }
  const hasSessionCookie = !!(req as any).cookies?.[SESSION_COOKIE_NAME];
  if (!hasSessionCookie) {
    // No cookie = no ambient credentials = no CSRF surface.
    return next();
  }
  if (!isOriginAllowed(req)) {
    res.status(403).json({
      error: "Origin required and must be allowed for cookie-authenticated state-changing requests",
    });
    return;
  }
  next();
}

