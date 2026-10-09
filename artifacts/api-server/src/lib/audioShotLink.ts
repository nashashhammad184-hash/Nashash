/**
 * KAYAN-TASK-47: link a generated audioUrl to a shot.
 *
 * Mirrors videoShotLink.ts. Used by POST /api/audio/generate when the
 * caller supplies an optional shotId. Keeps the standalone audio route
 * compatible with the timeline/sync + render/start manual workflow.
 */
import { db, shotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ShotLinkError = {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
};
export type ResolveAudioShotIdResult =
  | { readonly ok: true; readonly shotId: number | null }
  | ShotLinkError;
export type PersistAudioUrlResult =
  | { readonly ok: true; readonly audioUrl: string }
  | ShotLinkError;

export async function resolveAudioShotId(
  rawShotId: unknown,
  projectId: number,
): Promise<ResolveAudioShotIdResult> {
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

export async function persistAudioUrlToShot(
  shotId: number,
  audioUrl: unknown,
): Promise<PersistAudioUrlResult> {
  if (typeof audioUrl !== "string") {
    return { ok: false, status: 502, error: "audioUrl must be a string" };
  }
  const u = audioUrl.trim();
  if (u.length === 0) {
    return { ok: false, status: 502, error: "refusing to persist empty audioUrl to shot" };
  }
  // Only allow real assets: /uploads/... or http(s):// (never data:).
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/uploads/")) {
    return { ok: false, status: 400, error: `audioUrl is not a real asset path: ${u.slice(0, 40)}` };
  }
  try {
    const upd = await db
      .update(shotsTable)
      .set({ audioUrl: u, audioStatus: "COMPLETED" } as any)
      .where(eq(shotsTable.id, shotId));
    if (upd.rowCount !== 1) {
      return {
        ok: false,
        status: 500,
        error: `failed to persist audioUrl: expected 1 row, got ${upd.rowCount}`,
      };
    }
    return { ok: true, audioUrl: u };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: `failed to persist audioUrl on shot ${shotId}: ${msg}` };
  }
}
