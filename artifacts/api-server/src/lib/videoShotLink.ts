/**
 * KAYAN-TASK-45: link a generated videoUrl to a shot.
 *
 * Used by POST /api/video/generate when the caller supplies an optional
 * shotId. This keeps the standalone video route compatible with the
 * timeline/sync + render/start workflow without breaking clients that
 * don't send shotId.
 */
import { db, shotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ShotValidationError = {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
};
export type ResolveShotIdResult =
  | { readonly ok: true; readonly shotId: number | null }
  | ShotValidationError;
export type PersistVideoUrlResult =
  | { readonly ok: true; readonly videoUrl: string }
  | ShotValidationError;

/**
 * KAYAN-TASK-64: central validation of videoUrl format.
 *
 * Accepted:
 *   - /uploads/... (real local asset path)
 *   - http(s)://... (external provider URLs)
 *
 * Rejected explicitly:
 *   - javascript:, data:, file:, vbscript:, blob:, and any other scheme
 *   - empty / whitespace
 *   - paths containing ".." (traversal)
 *   - backslashes
 *
 * This does NOT verify the file exists — only the format.
 */
export function validateVideoUrl(input: unknown):
  | { ok: true; videoUrl: string }
  | { ok: false; error: string } {
  if (typeof input !== "string") {
    return { ok: false, error: "videoUrl must be a string" };
  }
  const u = input.trim();
  if (u.length === 0) {
    return { ok: false, error: "videoUrl is empty" };
  }
  if (u.includes("\\")) {
    return { ok: false, error: "videoUrl must not contain backslashes" };
  }
  if (u.includes("\u0000")) {
    return { ok: false, error: "videoUrl must not contain NUL byte" };
  }
  // Explicit scheme rejection (case-insensitive)
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      // allowed below (after traversal check)
    } else if (scheme === "javascript" || scheme === "data" || scheme === "file" ||
               scheme === "vbscript" || scheme === "blob" || scheme === "about") {
      return { ok: false, error: `videoUrl scheme not allowed: ${scheme}:` };
    } else if (scheme === "mailto" || scheme === "tel") {
      return { ok: false, error: `videoUrl scheme not allowed: ${scheme}:` };
    } else {
      return { ok: false, error: `videoUrl scheme not supported: ${scheme}:` };
    }
  }
  // Path traversal in any part of the string
  if (u.includes("..")) {
    return { ok: false, error: "videoUrl must not contain '..'" };
  }
  // Must start with /uploads/ OR be http(s)://
  if (u.startsWith("/uploads/")) {
    // Reject /uploads//... (empty segment) and /uploads/./...
    const rest = u.slice("/uploads/".length);
    if (rest.length === 0 || rest.startsWith("/") || rest.split("/").some(s => s.length === 0 || s === ".")) {
      return { ok: false, error: "videoUrl has invalid /uploads/ path" };
    }
    return { ok: true, videoUrl: u };
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `videoUrl protocol not allowed: ${parsed.protocol}` };
      }
      return { ok: true, videoUrl: u };
    } catch {
      return { ok: false, error: "videoUrl is not a valid http(s) URL" };
    }
  }
  return { ok: false, error: "videoUrl must be /uploads/... or http(s)://..." };
}

/**
 * Parse and validate an optional shotId from the request body.
 * Returns { ok: true, shotId: null } when the field is absent.
 */
export async function resolveShotId(
  rawShotId: unknown,
  projectId: number,
): Promise<ResolveShotIdResult> {
  if (rawShotId === undefined || rawShotId === null) {
    return { ok: true, shotId: null };
  }
  const n = Number(rawShotId);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, status: 400, error: "shotId must be a positive integer" };
  }
  const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, n)).limit(1);
  if (!row) {
    return { ok: false, status: 404, error: `shotId ${n} not found` };
  }
  if (row.projectId !== projectId) {
    return {
      ok: false,
      status: 400,
      error: `shotId ${n} belongs to project ${row.projectId}, not ${projectId}`,
    };
  }
  return { ok: true, shotId: n };
}

/**
 * Persist a videoUrl to a shot row. Refuses empty/whitespace URLs and
 * treats any non-1 rowCount as an explicit failure (no fake success).
 */
export async function persistVideoUrlToShot(
  shotId: number,
  videoUrl: unknown,
): Promise<PersistVideoUrlResult> {
  // KAYAN-TASK-64: central format validation.
  const v = validateVideoUrl(videoUrl);
  if (v.ok === false) {
    return { ok: false, status: 400, error: v.error };
  }
  const vu = v.videoUrl;
  try {
    const upd = await db
      .update(shotsTable)
      .set({ videoUrl: vu })
      .where(eq(shotsTable.id, shotId));
    if (upd.rowCount !== 1) {
      return {
        ok: false,
        status: 500,
        error: `failed to persist videoUrl: expected 1 row, got ${upd.rowCount}`,
      };
    }
    return { ok: true, videoUrl: vu };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: `failed to persist videoUrl on shot ${shotId}: ${msg}` };
  }
}
