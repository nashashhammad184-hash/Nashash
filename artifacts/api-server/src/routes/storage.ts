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

export default router;
