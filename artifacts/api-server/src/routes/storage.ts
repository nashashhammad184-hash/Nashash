/**
 * KAYAN-TASK-73E: internal R2 storage proxy.
 *
 * Serves objects from the configured storage provider under
 *   GET /api/storage/r2/<key>
 *
 * Key rules:
 *   - Key must pass assertSafeKey (no traversal, no leading slash, etc.).
 *   - Only the active provider's read() is used; no external URLs allowed.
 *   - Content-Type is set from the file extension; Content-Length always.
 *   - HTTP Range supported (single range) for video streaming.
 *   - No credentials ever appear in URLs or error bodies.
 *   - Authentication: same rate limit + auth as other /api routes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getStorage, assertSafeKey, StorageError } from "../lib/storage/index";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";
import { detectImageMime } from "../lib/actorReference";
import { db, shotsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
// KAYAN-TASK-79: signed URL endpoint requires auth.
import { requireProductionAuth } from "../lib/securityMiddleware";

const router: IRouter = Router();

function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".mp4": return "video/mp4";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".srt": return "application/x-subrip; charset=utf-8";
    case ".vtt": return "text/vtt; charset=utf-8";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

// ================================================================
// KAYAN-TASK-79: GET /api/storage/r2/sign?key=<key>
// Issues a short-lived signed URL for authorized prefixes only.
// ================================================================
const SIGN_ALLOWED_PREFIXES = ["videos/", "audio/", "renders/", "subtitles/"];
const SIGN_DENIED_PREFIXES = ["canonical_faces/", "actors/refs/", "actors/", "storage_vault/"];
const SIGN_DEFAULT_TTL_SEC = 900;
const SIGN_MAX_TTL_SEC = 3600;
const SIGN_MIN_TTL_SEC = 60;

router.get("/storage/r2/sign", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const rawKey = String(req.query.key || "");
  if (!rawKey) {
    res.status(400).json({ error: "key query parameter is required" });
    return;
  }
  let key: string;
  try {
    key = assertSafeKey(rawKey);
  } catch (e: any) {
    res.status(400).json({ error: "Invalid storage key" });
    return;
  }

  // Deny list first (defense in depth), then allow list.
  for (const pfx of SIGN_DENIED_PREFIXES) {
    if (key.startsWith(pfx)) {
      logger.warn({ key }, "sign: denied prefix");
      res.status(403).json({ error: "Key prefix not allowed for signing" });
      return;
    }
  }
  let allowed = false;
  for (const pfx of SIGN_ALLOWED_PREFIXES) {
    if (key.startsWith(pfx)) { allowed = true; break; }
  }
  if (!allowed) {
    logger.warn({ key }, "sign: prefix not in allow list");
    res.status(403).json({ error: "Key prefix not allowed for signing" });
    return;
  }

  // TTL from env, bounded.
  const envTtl = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || String(SIGN_DEFAULT_TTL_SEC));
  const ttl = Math.max(
    SIGN_MIN_TTL_SEC,
    Math.min(SIGN_MAX_TTL_SEC, Number.isFinite(envTtl) && envTtl > 0 ? Math.floor(envTtl) : SIGN_DEFAULT_TTL_SEC),
  );

  const provider = getStorage();
  if (typeof provider.getSignedUrl !== "function") {
    res.status(500).json({ error: "Storage provider does not support signing" });
    return;
  }

  let result: { url: string; expiresAt: number | null };
  try {
    result = await provider.getSignedUrl(key, ttl);
  } catch (e: any) {
    if (e instanceof StorageError && e.code === "NOT_FOUND") {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    if (e instanceof StorageError && e.code === "SIGNER_UNAVAILABLE") {
      res.status(500).json({ error: "Signed URL subsystem unavailable" });
      return;
    }
    logger.warn({ err: e?.message, key, provider: provider.name }, "sign: failed");
    res.status(500).json({ error: "Failed to issue signed URL" });
    return;
  }

  // Log without the URL itself.
  logger.info({ key, ttl, provider: provider.name }, "sign: issued");
  res.json({ url: result.url, expiresAt: result.expiresAt, ttlSeconds: ttl });
});

// GET /api/storage/r2/{*key}  — Express 5 named wildcard syntax.
router.get("/storage/r2/{*key}", async (req: Request, res: Response): Promise<void> => {
  // Express 5 wildcard returns an array of path segments — join them.
  const raw = (req.params as any).key;
  const rawKey = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  let key: string;
  try {
    key = assertSafeKey(decodeURIComponent(rawKey));
  } catch (e: any) {
    res.status(400).json({ error: "Invalid storage key" });
    return;
  }

  const provider = getStorage();
  if (provider.name !== "r2") {
    // Only serve from the r2 provider; under local, /uploads/* serves the file.
    res.status(404).json({ error: "R2 storage not active" });
    return;
  }

  let buf: Buffer;
  try {
    buf = await provider.read(key);
  } catch (e: any) {
    if (e instanceof StorageError && e.code === "NOT_FOUND") {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    logger.warn({ err: e?.message, key }, "storage proxy read failed");
    res.status(502).json({ error: "Storage read failed" });
    return;
  }

  const total = buf.length;
  const ct = contentTypeForKey(key);
  res.setHeader("Content-Type", ct);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0");

  // Range support (single range, RFC 7233).
  const range = req.headers.range;
  if (typeof range === "string" && range.startsWith("bytes=")) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const startStr = m[1];
      const endStr = m[2];
      let start = startStr === "" ? 0 : parseInt(startStr, 10);
      let end = endStr === "" ? total - 1 : parseInt(endStr, 10);
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const slice = buf.subarray(start, end + 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(slice.length));
      res.end(slice);
      return;
    }
  }

  res.setHeader("Content-Length", String(total));
  res.status(200).end(buf);
});


// ================================================================
// KAYAN-TASK-46: GET /api/storage/supabase/{*key}
// Serves private Supabase Storage objects. Requires a valid session
// (kayan_session cookie OR Bearer PRODUCTION_API_TOKEN) — same auth
// policy as /storage/r2/sign.
//
// Design:
//   - Prefer a 302 redirect to a short-lived signed Supabase URL. The
//     browser's <video>/<img> then fetches bytes directly from Supabase:
//     no memory in our server, no bandwidth in our server, Range handled
//     by Supabase (their CDN supports HTTP Range natively).
//   - Fallback (if signing unavailable): buffer + manual HTTP Range,
//     identical to the /storage/r2/{*key} handler.
//   - Never expose a permanent public URL. The publicUrl() stored in DB
//     stays "/api/storage/supabase/<key>" so the proxy path remains
//     stable if we later swap Supabase for another S3-compatible store.
// ================================================================
const SUPABASE_SIGNED_URL_TTL_SEC = 3600; // 1h — long videos stay playable
router.get("/storage/supabase/{*key}", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const raw = (req.params as any).key;
  const rawKey = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  let key: string;
  try {
    // decodeURIComponent throws URIError on malformed input (e.g., "%ZZ").
    // Both that and StorageError from assertSafeKey are client errors → 400,
    // never 500.
    key = assertSafeKey(decodeURIComponent(rawKey));
  } catch (e: any) {
    res.status(400).json({ error: "Invalid storage key" });
    return;
  }

  const provider = getStorage();
  if (provider.name !== "supabase") {
    // Only serve from the supabase provider; under local, /uploads/* serves
    // the file; under r2, /storage/r2/* serves the file.
    res.status(404).json({ error: "Supabase storage not active" });
    return;
  }

  // Primary path: signed-URL redirect (no memory, Range handled by Supabase).
  if (typeof provider.getSignedUrl === "function") {
    try {
      const signed = await provider.getSignedUrl(key, SUPABASE_SIGNED_URL_TTL_SEC);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.redirect(302, signed.url);
      return;
    } catch (e: any) {
      if (e instanceof StorageError && e.code === "NOT_FOUND") {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      // Signing unavailable or transient failure → fall through to buffer.
      logger.warn({ err: e?.message, key }, "supabase storage: sign failed, falling back to buffer");
    }
  }

  // Fallback: buffer + manual Range (defensive; mirrors r2 handler).
  //
  // KAYAN-TASK-48: The fallback loads the ENTIRE file into memory. On Render
  // Free (512 MB RAM) a 50 MB Supabase upload could push the process over
  // the limit. If signing failed, cap the fallback size; if the size is
  // unknown, refuse instead of assuming it is small.
  const MAX_FALLBACK_BYTES = 10 * 1024 * 1024; // 10 MB
  if (typeof provider.getSize === "function") {
    let size: number | null = null;
    try {
      size = await provider.getSize(key);
    } catch {
      size = null;
    }
    if (size === null) {
      logger.warn({ key, provider: provider.name }, "supabase storage: signer failed AND size unknown; refusing in-memory fallback");
      res.status(503).json({ error: "Storage temporarily unavailable (size unknown); please retry" });
      return;
    }
    if (size > MAX_FALLBACK_BYTES) {
      logger.warn({ key, size, limit: MAX_FALLBACK_BYTES }, "supabase storage: signer failed AND file exceeds in-memory fallback limit");
      res.status(503).json({ error: "Storage temporarily unavailable; file too large for in-memory fallback" });
      return;
    }
  } else {
    // Provider has no getSize() — cannot verify size → refuse.
    logger.warn({ key, provider: provider.name }, "supabase storage: signer failed AND provider has no getSize(); refusing in-memory fallback");
    res.status(503).json({ error: "Storage temporarily unavailable; cannot verify size" });
    return;
  }

  let buf: Buffer;
  try {
    buf = await provider.read(key);
  } catch (e: any) {
    if (e instanceof StorageError && e.code === "NOT_FOUND") {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    logger.warn({ err: e?.message, key }, "supabase storage proxy read failed");
    res.status(502).json({ error: "Storage read failed" });
    return;
  }

  const total = buf.length;
  const ct = contentTypeForKey(key);
  res.setHeader("Content-Type", ct);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=60");

  const range = req.headers.range;
  if (typeof range === "string" && range.startsWith("bytes=")) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const startStr = m[1];
      const endStr = m[2];
      let start = startStr === "" ? 0 : parseInt(startStr, 10);
      let end = endStr === "" ? total - 1 : parseInt(endStr, 10);
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const slice = buf.subarray(start, end + 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(slice.length));
      res.end(slice);
      return;
    }
  }

  res.setHeader("Content-Length", String(total));
  res.status(200).end(buf);
});

// ================================================================
// KAYAN-6: pure, testable upload logic (no I/O, no globals).
// ================================================================
export interface UploadValidationOk {
  ok: true;
  buffer: Buffer;
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
}
export interface UploadValidationErr {
  ok: false;
  status: number;
  error: string;
}

export function validateUploadPayload(
  body: { contentBase64?: unknown } | null | undefined,
): UploadValidationOk | UploadValidationErr {
  const raw = body && body.contentBase64;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, status: 400, error: "contentBase64 is required" };
  }
  const c = raw;
  if (c.length % 4 !== 0 || c.length > 7340032) {
    return { ok: false, status: 400, error: "bad payload" };
  }
  const k = c.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(k)) {
    return { ok: false, status: 400, error: "invalid base64" };
  }
  const buf = Buffer.from(k, "base64");
  if (buf.length < 10240 || buf.length > 5242880) {
    return { ok: false, status: 400, error: "size out of range" };
  }
  const mime = detectImageMime(buf);
  if (!mime) {
    return { ok: false, status: 400, error: "not png or jpeg" };
  }
  return { ok: true, buffer: buf, mime, ext: mime === "image/png" ? "png" : "jpg" };
}

export interface UploadResult {
  status: number;
  json: Record<string, unknown>;
}
export interface UploadDeps {
  providerName: string;
  write: (key: string, buf: Buffer, mime: string) => Promise<string>;
  makeKey: (ext: "png" | "jpg") => string;
}

export async function processUpload(
  body: { contentBase64?: unknown } | null | undefined,
  deps: UploadDeps,
): Promise<UploadResult> {
  const v = validateUploadPayload(body);
  if (v.ok === false) {
    return { status: v.status, json: { error: v.error } };
  }
  if (deps.providerName !== "supabase") {
    return { status: 400, json: { error: "requires supabase provider" } };
  }
  try {
    const key = deps.makeKey(v.ext);
    await deps.write(key, v.buffer, v.mime);
    return { status: 201, json: { assetUrl: "/uploads/" + key, key } };
  } catch {
    return { status: 500, json: { error: "upload failed" } };
  }
}

router.post("/storage/upload", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const p = getStorage();
  const r = await processUpload(req.body || {}, {
    providerName: p.name,
    write: (key, buf, mime) => p.write(key, buf, mime),
    makeKey: (ext) => "actor-refs/" + randomUUID() + "." + ext,
  });
  if (r.status >= 500) {
    logger.error({ json: r.json }, "storage/upload: failed");
  }
  res.status(r.status).json(r.json);
});

router.post("/storage/upload-video", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = (req.body || {}).contentBase64;
    if (typeof raw !== "string" || raw.length === 0) { res.status(400).json({ error: "contentBase64 is required" }); return; }
    if (raw.length % 4 !== 0 || raw.length > 7 * 1024 * 1024) { res.status(400).json({ error: "bad payload" }); return; }
    const k = raw.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(k)) { res.status(400).json({ error: "invalid base64" }); return; }
    const buf = Buffer.from(k, "base64");
    if (buf.length < 10 * 1024 || buf.length > 5 * 1024 * 1024) { res.status(400).json({ error: "video size out of range (10KB-5MB)" }); return; }
    if (buf.length < 12 || buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) { res.status(400).json({ error: "not a valid MP4 (missing ftyp box)" }); return; }
    const provider = getStorage();
    if (provider.name !== "supabase") { res.status(400).json({ error: "upload requires STORAGE_PROVIDER=supabase" }); return; }
    const key = "videos/" + randomUUID() + ".mp4";
    await provider.write(key, buf, "video/mp4");
    res.status(201).json({ assetUrl: "/api/storage/supabase/" + key, key });
  } catch (err: any) {
    logger.error({ err: err && err.message }, "storage/upload-video: failed");
    res.status(500).json({ error: "video upload failed" });
  }
});

router.post("/storage/sign-upload", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, shotId, mimeType, fileSize } = req.body || {};
    
    if (typeof projectId !== "number" || typeof shotId !== "number") {
      res.status(400).json({ error: "projectId and shotId must be numbers" });
      return;
    }
    if (mimeType !== "audio/mpeg") {
      res.status(400).json({ error: "Only audio/mpeg is allowed" });
      return;
    }
    if (typeof fileSize !== "number" || fileSize <= 0 || fileSize > 10 * 1024 * 1024) {
      res.status(400).json({ error: "fileSize must be between 1 and 10MB" });
      return;
    }
    
    const shot = await db.select().from(shotsTable).where(and(eq(shotsTable.id, shotId), eq(shotsTable.projectId, projectId))).limit(1);
    if (shot.length === 0) {
      res.status(403).json({ error: "Shot not found or does not belong to project" });
      return;
    }
    
    const provider = getStorage();
    if (typeof provider.getSignedUploadUrl !== "function") {
      res.status(501).json({ error: "Current storage provider does not support signed uploads" });
      return;
    }
    
    const key = "audio/" + randomUUID() + ".mp3";
    const result = await provider.getSignedUploadUrl(key, { upsert: false });
    
    res.status(200).json({
      signedUrl: result.signedUrl,
      token: result.token,
      filePath: key
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "sign-upload failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
