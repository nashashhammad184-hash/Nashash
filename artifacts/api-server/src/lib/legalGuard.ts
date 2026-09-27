/**
 * KAYAN-LEGAL-00 — Synthetic Character Policy Guard
 * Rejects any reference not clearly a synthetic character asset.
 * Allowed: data:image/*, uploads/*, storage_vault/*, or body.syntheticAcknowledged===true.
 * Rejected: any other external URL.
 */
const SYNTHETIC_PATH_PREFIXES = [
  "uploads/", "/uploads/", "storage_vault/", "/storage_vault/", "./uploads/",
];

export function isSyntheticReference(url: string, body: any): boolean {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (u.startsWith("data:image/")) return true;
  if (SYNTHETIC_PATH_PREFIXES.some((p) => u.startsWith(p))) return true;
  if (body && body.syntheticAcknowledged === true) return true;
  return false;
}

export function assertSyntheticReference(url: string, body: any): void {
  if (!isSyntheticReference(url, body)) {
    const err: any = new Error(
      "LEGAL_GUARD: Non-synthetic reference rejected. " +
      "Set syntheticAcknowledged=true to confirm a fully synthetic character asset. " +
      "Real-person references are not permitted in Production."
    );
    err.statusCode = 400;
    err.code = "LEGAL_GUARD_NON_SYNTHETIC";
    throw err;
  }
}
