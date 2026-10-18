/**
 * KAYAN-TASK-79: cookie-based session authentication.
 *
 * Design:
 *   - Stateless session token = base64url(payload) + "." + base64url(hmac).
 *   - Payload: { iat: ms, exp: ms, v: 1 }
 *   - HMAC-SHA256 with SESSION_SECRET.
 *   - Cookie: HttpOnly, Secure (in production), SameSite=Lax, Path=/.
 *   - Fail-closed: if SESSION_SECRET not set → refuse to issue or accept.
 *
 * Security properties:
 *   - PRODUCTION_API_TOKEN never appears in the cookie value.
 *   - Constant-time comparison for token verification.
 *   - No secret logging.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE_NAME = "kayan_session";
const SESSION_TTL_MS_DEFAULT = 12 * 60 * 60 * 1000; // 12h
const COOKIE_PATH = "/";

interface SessionPayload {
  readonly iat: number;
  readonly exp: number;
  readonly v: 1;
}

function sessionSecret(): Buffer {
  const s = process.env.SESSION_SECRET?.trim();
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET is not configured (>=32 chars required)");
  }
  return Buffer.from(s, "utf-8");
}

function isProduction(): boolean {
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", sessionSecret()).update(payload).digest();
  return b64url(mac);
}

export function createSessionToken(ttlMs?: number): { token: string; expiresAt: number } {
  const ttl = Number.isFinite(ttlMs) && (ttlMs as number) > 0 ? (ttlMs as number) : SESSION_TTL_MS_DEFAULT;
  const now = Date.now();
  const payload: SessionPayload = { iat: now, exp: now + ttl, v: 1 };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: payload.exp };
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null;
  }
  // Constant-time comparison
  const a = Buffer.from(sig, "utf-8");
  const b = Buffer.from(expectedSig, "utf-8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(payloadB64).toString("utf-8"));
    if (payload?.v !== 1) return null;
    if (typeof payload?.iat !== "number" || typeof payload?.exp !== "number") return null;
    if (Date.now() >= payload.exp) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function constantTimeTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    // still run a comparison to reduce timing signal
    try { crypto.timingSafeEqual(a, a); } catch {}
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export interface SessionSetOptions {
  readonly ttlMs?: number;
}

export function setSessionCookie(res: Response, opts: SessionSetOptions = {}): number {
  const { token, expiresAt } = createSessionToken(opts.ttlMs);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: expiresAt - Date.now(),
  });
  return expiresAt;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: COOKIE_PATH,
  });
}

export interface SessionReadResult {
  readonly authenticated: boolean;
  readonly payload?: SessionPayload;
  readonly source?: "cookie" | "bearer";
}

/**
 * Read session from cookie OR Bearer header.
 * Bearer must match PRODUCTION_API_TOKEN (constant-time).
 * Never throws.
 */
export function readSession(req: Request): SessionReadResult {
  // 1. Cookie
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const payload = verifySessionToken(cookieToken);
    if (payload) return { authenticated: true, payload, source: "cookie" };
  }
  // 2. Bearer
  const expected = process.env.PRODUCTION_API_TOKEN?.trim();
  const header = req.headers.authorization;
  if (expected && typeof header === "string" && header.startsWith("Bearer ")) {
    const provided = header.slice("Bearer ".length).trim();
    if (constantTimeTokenEqual(provided, expected)) {
      return { authenticated: true, source: "bearer" };
    }
  }
  return { authenticated: false };
}
