/**
 * KAYAN-TASK-25 — canonical name of the active video provider.
 *
 * Reflects the current runtime configuration so API responses and DB records
 * report the actual provider, not a hard-coded string.
 *
 * Mapping:
 *   VIDEO_PROVIDER=external + VIDEO_EXTERNAL_KIND=wavespeed → "wavespeed"
 *   VIDEO_PROVIDER=external + VIDEO_EXTERNAL_KIND=mock      → "external-mock"
 *   VIDEO_PROVIDER=external + other kinds                    → "external-<kind>"
 *   VIDEO_PROVIDER=kayangpu (or unset)                       → "kayan-gpu-worker"
 */
export function getActiveVideoProvider(): string {
  const which = (process.env.VIDEO_PROVIDER || "kayangpu").toLowerCase();
  if (which === "external") {
    const kind = (process.env.VIDEO_EXTERNAL_KIND || "wavespeed").toLowerCase();
    if (kind === "wavespeed") return "wavespeed";
    return `external-${kind}`;
  }
  return "kayan-gpu-worker";
}
