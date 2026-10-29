/**
 * KAYAN-7: single source of truth for "is this AI-generated video real?"
 * Decided from the provider name — never from the file name or extension.
 * Any provider whose name is "mock" OR ends with "-mock" (e.g. the
 * getActiveVideoProvider() label "external-mock") is NOT real AI.
 */
export function isRealAIProvider(provider: string | null | undefined): boolean {
  if (typeof provider !== "string" || provider.length === 0) return false;
  if (provider === "mock") return false;
  if (provider.endsWith("-mock")) return false;
  return true;
}
