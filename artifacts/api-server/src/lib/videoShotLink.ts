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
  if (typeof videoUrl !== "string") {
    return { ok: false, status: 502, error: "videoUrl must be a string" };
  }
  const vu = videoUrl.trim();
  if (vu.length === 0) {
    return { ok: false, status: 502, error: "refusing to persist empty videoUrl to shot" };
  }
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
