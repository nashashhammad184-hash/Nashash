import { type Request, type Response, type NextFunction } from "express";
import net from "node:net";

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
export function requireProductionAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.PRODUCTION_API_TOKEN?.trim();
  if (!expectedToken) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Bearer token required for production operations." });
    return;
  }
  const provided = authHeader.slice("Bearer ".length).trim();
  if (provided !== expectedToken) {
    res.status(401).json({ error: "Unauthorized: invalid production token." });
    return;
  }
  next();
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
