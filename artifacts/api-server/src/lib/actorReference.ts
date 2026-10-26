/**
 * KAYAN-CINEMA-16: actor reference resolution.
 *
 * Given an optional actorId + projectId, fetch the actor's canonical reference
 * image from the storage layer, validate it, and return it as a base64 string
 * ready to be passed to the video provider's i2v path.
 *
 * Security invariants enforced here:
 *   - actor must be LINKED to the project via project_actors (403 otherwise)
 *   - actor must exist (404)
 *   - actor must have at least one reference image (400)
 *   - image must resolve to a readable local file via the storage layer
 *   - file must be 10KB–5MB (prevents abuse)
 *   - file must be PNG or JPEG (magic-number check)
 *   - errors never leak internal paths or secrets
 *
 * DB and storage calls go through injectable deps so tests can mock them.
 */
import fs from "node:fs";
import { eq, and } from "drizzle-orm";
import { db, actorsTable, projectActorsTable, characterReferencesTable } from "@workspace/db";
import { resolveStorageUrlToLocal } from "./storage/index";

export interface ResolveActorRefInput {
  actorId: unknown;
  projectId: number;
  explicitReferenceImageBase64?: string | null;
}

export interface ResolveActorRefResult {
  ok: true;
  task: "t2v" | "i2v";
  referenceImageBase64: string | null;
  actorId: number | null;
  source: "actor" | "explicit" | "none";
}

export interface ResolveActorRefError {
  ok: false;
  status: number;
  error: string;
}

type Deps = {
  getDb: () => typeof db;
  resolveLocal: typeof resolveStorageUrlToLocal;
  readFile: (path: string) => Buffer;
  statFile: (path: string) => { size: number };
};

const defaultDeps: Deps = {
  getDb: () => db,
  resolveLocal: (url) => resolveStorageUrlToLocal(url),
  readFile: (path) => fs.readFileSync(path),
  statFile: (path) => fs.statSync(path),
};

let _deps: Deps = { ...defaultDeps };

/** KAYAN-CINEMA-16: test-only injection. Call with no args to reset. */
export function _setActorRefDeps(overrides: Partial<Deps> = {}): void {
  _deps = { ...defaultDeps, ...overrides };
}
export function _resetActorRefDeps(): void {
  _deps = { ...defaultDeps };
}

export const MIN_IMAGE_BYTES = 10 * 1024; // 10 KB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** PNG: \x89 P N G \r \n \x1a \n. JPEG: \xFF \xD8 \xFF. */
export function detectImageMime(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

// KAYAN-GUARD-30: fallback to character_references when actor columns are empty.
// The upload endpoint POST /actors/:id/references writes there; resolveActorReference
// must consult it or uploaded images are never used for video generation.
async function _pickReferenceFromTable(actorId: number): Promise<string | null> {
  try {
    const rows = await _deps.getDb()
      .select({ assetUrl: characterReferencesTable.assetUrl, isPrimary: characterReferencesTable.isPrimary, referenceType: characterReferencesTable.referenceType, id: characterReferencesTable.id })
      .from(characterReferencesTable)
      .where(eq(characterReferencesTable.actorId, actorId));
    if (!rows || rows.length === 0) return null;
    // Prefer primary image, then any image, then anything.
    const imgs = rows.filter((r: any) => r.referenceType === "image" || r.referenceType == null);
    const primary = imgs.find((r: any) => r.isPrimary === true);
    const chosen = primary || imgs[0] || rows[0];
    if (chosen && typeof chosen.assetUrl === "string" && chosen.assetUrl.trim().length > 0) {
      return chosen.assetUrl.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function pickActorImageUrl(actor: {
  canonicalFaceImagePath?: string | null;
  imageUrl?: string | null;
  faceReferenceUrl?: string | null;
}): string | null {
  // Priority: fixed canonical face (best for i2v) → primary image → face ref.
  const candidates = [actor.canonicalFaceImagePath, actor.imageUrl, actor.faceReferenceUrl];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

export async function resolveActorReference(
  input: ResolveActorRefInput,
): Promise<ResolveActorRefResult | ResolveActorRefError> {
  const rawActorId = input.actorId;
  const hasActorId = rawActorId !== undefined && rawActorId !== null && String(rawActorId).trim() !== "";
  const hasExplicit = typeof input.explicitReferenceImageBase64 === "string"
    && input.explicitReferenceImageBase64.trim().length >= 64;

  // No actor → pass through (existing behavior).
  if (!hasActorId) {
    if (hasExplicit) {
      return { ok: true, task: "i2v", referenceImageBase64: input.explicitReferenceImageBase64!.trim(), actorId: null, source: "explicit" };
    }
    return { ok: true, task: "t2v", referenceImageBase64: null, actorId: null, source: "none" };
  }

  // Actor requested → validate actorId is a positive integer.
  const n = Number(rawActorId);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, status: 400, error: "actorId must be a positive integer" };
  }

  // 1. Verify actor is LINKED to this project.
  try {
    const link = await _deps.getDb()
      .select({ actorId: projectActorsTable.actorId })
      .from(projectActorsTable)
      .where(and(
        eq(projectActorsTable.projectId, input.projectId),
        eq(projectActorsTable.actorId, n),
      ))
      .limit(1);
    if (link.length === 0) {
      return { ok: false, status: 403, error: `actor ${n} is not linked to project ${input.projectId}` };
    }
  } catch {
    return { ok: false, status: 500, error: "failed to verify actor-project link" };
  }

  // 2. Fetch actor record.
  let actorRow: any;
  try {
    const rows = await _deps.getDb()
      .select()
      .from(actorsTable)
      .where(eq(actorsTable.id, n))
      .limit(1);
    actorRow = rows[0];
  } catch {
    return { ok: false, status: 500, error: "failed to fetch actor" };
  }
  if (!actorRow) {
    return { ok: false, status: 404, error: `actor ${n} not found` };
  }

  // 3. Pick reference image URL (actor columns, then character_references fallback).
  let imageUrl = pickActorImageUrl(actorRow);
  if (!imageUrl) {
    imageUrl = await _pickReferenceFromTable(n);
  }
  if (!imageUrl) {
    return { ok: false, status: 400, error: `actor ${n} has no reference image` };
  }

  // 4. Resolve to local file via storage layer.
  let resolved: Awaited<ReturnType<typeof resolveStorageUrlToLocal>>;
  try {
    resolved = await _deps.resolveLocal(imageUrl);
  } catch {
    return { ok: false, status: 500, error: `failed to resolve actor ${n} reference image` };
  }

  try {
    // 5. Validate file size.
    let size: number;
    try {
      const st = _deps.statFile(resolved.path);
      size = st.size;
    } catch {
      return { ok: false, status: 500, error: `actor ${n} reference image is not readable` };
    }
    if (size < MIN_IMAGE_BYTES) {
      return { ok: false, status: 400, error: `actor ${n} reference image too small (${size} bytes)` };
    }
    if (size > MAX_IMAGE_BYTES) {
      return { ok: false, status: 400, error: `actor ${n} reference image too large (${size} bytes)` };
    }

    // 6. Read + validate type.
    let buf: Buffer;
    try {
      buf = _deps.readFile(resolved.path);
    } catch {
      return { ok: false, status: 500, error: `failed to read actor ${n} reference image` };
    }
    const mime = detectImageMime(buf);
    if (!mime) {
      return { ok: false, status: 400, error: `actor ${n} reference image is not PNG/JPEG` };
    }

    const b64 = buf.toString("base64");
    return {
      ok: true,
      task: "i2v",
      referenceImageBase64: b64,
      actorId: n,
      source: "actor",
    };
  } finally {
    try { await resolved.cleanup(); } catch { /* swallow */ }
  }
}

// ============================================================
// KAYAN-CINEMA-17A: loadActorImageBytes — serve actor image for UI.
//
// Unlike resolveActorReference (which returns base64 for video gen), this
// returns the raw bytes + MIME for HTTP image responses. Reuses the same
// deps injection (_deps) for testability and the same security invariants:
//   - actorId must be positive integer
//   - actor must exist
//   - actor must be linked to at least one project (via project_actors)
//   - image URL must resolve to a local file via storage layer
//   - file must be 10KB–5MB and PNG/JPEG
//   - cleanup() is always called (even on error path after resolve)
//   - no path leaks in error messages
// ============================================================

export interface LoadActorImageResult {
  ok: true;
  buffer: Buffer;
  mime: "image/png" | "image/jpeg";
  size: number;
}

export interface LoadActorImageError {
  ok: false;
  status: number;
  error: string;
}

export async function loadActorImageBytes(
  actorId: number,
): Promise<LoadActorImageResult | LoadActorImageError> {
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return { ok: false, status: 400, error: "actorId must be a positive integer" };
  }

  // 1. Fetch actor.
  let actorRow: any;
  try {
    const rows = await _deps.getDb()
      .select()
      .from(actorsTable)
      .where(eq(actorsTable.id, actorId))
      .limit(1);
    actorRow = rows[0];
  } catch {
    return { ok: false, status: 500, error: "failed to fetch actor" };
  }
  if (!actorRow) {
    return { ok: false, status: 404, error: "actor not found" };
  }

  // 2. Authorization: actor must be linked to at least one project.
  // (Single-tenant model: any authenticated user can see any linked actor,
  //  but orphan actors are not exposed through this route.)
  try {
    const links = await _deps.getDb()
      .select({ actorId: projectActorsTable.actorId })
      .from(projectActorsTable)
      .where(eq(projectActorsTable.actorId, actorId))
      .limit(1);
    if (links.length === 0) {
      return { ok: false, status: 404, error: "actor is not linked to any accessible project" };
    }
  } catch {
    return { ok: false, status: 500, error: "failed to verify actor access" };
  }

  // 3. Pick image URL (actor columns, then character_references fallback).
  let imageUrl = pickActorImageUrl(actorRow);
  if (!imageUrl) {
    imageUrl = await _pickReferenceFromTable(actorId);
  }
  if (!imageUrl) {
    return { ok: false, status: 404, error: "actor has no reference image" };
  }

  // 4. Resolve to local via storage layer.
  let resolved: Awaited<ReturnType<typeof resolveStorageUrlToLocal>>;
  try {
    resolved = await _deps.resolveLocal(imageUrl);
  } catch {
    return { ok: false, status: 404, error: "failed to resolve actor image" };
  }

  try {
    // 5. Size validation.
    let size: number;
    try {
      size = _deps.statFile(resolved.path).size;
    } catch {
      return { ok: false, status: 500, error: "failed to stat actor image" };
    }
    if (size < MIN_IMAGE_BYTES) {
      return { ok: false, status: 400, error: "actor image too small" };
    }
    if (size > MAX_IMAGE_BYTES) {
      return { ok: false, status: 400, error: "actor image too large" };
    }

    // 6. Read + MIME detection.
    let buf: Buffer;
    try {
      buf = _deps.readFile(resolved.path);
    } catch {
      return { ok: false, status: 500, error: "failed to read actor image" };
    }
    const mime = detectImageMime(buf);
    if (!mime) {
      return { ok: false, status: 400, error: "actor image is not PNG/JPEG" };
    }

    return { ok: true, buffer: buf, mime, size: buf.length };
  } finally {
    try { await resolved.cleanup(); } catch { /* swallow */ }
  }
}
