/**
 * KAYAN-TASK-03 — Synthetic Character Policy Guard (hardened).
 *
 * ACCEPTED:
 *   - data:image/*  (inline synthetic image)
 *   - uploads/*     (controlled local storage)
 *   - storage_vault/*
 *
 * REJECTED:
 *   - Any external URL, with or without syntheticAcknowledged.
 *     A client-side boolean is NOT proof of synthetic origin.
 *   - Real-person references (never permitted in Production).
 *
 * To ingest an external URL into Production, download it into controlled
 * storage first (uploads/ or storage_vault/) via an authorized ingestion
 * path, then re-submit the local path. There is no bypass.
 */
const SYNTHETIC_PATH_PREFIXES = [
  "uploads/",
  "/uploads/",
  "storage_vault/",
  "/storage_vault/",
  "./uploads/",
];

// KAYAN-TASK-73E: internal R2 storage paths served by this app's own proxy
// route (/api/storage/r2/...) with strict key validation.
const INTERNAL_R2_PREFIX = "/api/storage/r2/";
export function isSyntheticReference(url: string, _body?: any): boolean {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (u.length === 0) return false;
  if (u.startsWith("data:image/")) return true;
  if (SYNTHETIC_PATH_PREFIXES.some((p) => u.startsWith(p))) return true;
  // KAYAN-TASK-73E: accept internal proxy paths with safe keys only.
  if (u.startsWith(INTERNAL_R2_PREFIX)) {
    const key = u.slice(INTERNAL_R2_PREFIX.length);
    if (key.length === 0) return false;
    if (key.includes("..")) return false;
    if (key.includes(String.fromCharCode(92))) return false;
    if (key.startsWith("/")) return false;
    return true;
  }
  return false;
}

export function assertSyntheticReference(url: string, body?: any): void {
  if (!isSyntheticReference(url, body)) {
    const err: any = new Error(
      "LEGAL_GUARD: Non-synthetic reference rejected. " +
      "Only data:image/* or local controlled storage (uploads/, storage_vault/, /api/storage/r2/) is accepted. " +
      "External URLs must be ingested into controlled storage before use. " +
      "Client-side syntheticAcknowledged is not accepted as proof. " +
      "Real-person references are not permitted in Production."
    );
    err.statusCode = 400;
    err.code = "LEGAL_GUARD_NON_SYNTHETIC";
    throw err;
  }
}
