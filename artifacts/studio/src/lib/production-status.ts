/**
 * KAYAN-CINEMA-05: pure status helpers for production jobs.
 * Extracted from production.tsx so they can be unit-tested.
 */

export interface ProductionJobLike {
  status: string;
  error?: string | null;
  submitUncertain?: boolean;
}

/**
 * Detect whether a job is in the SUBMIT_UNCERTAIN state.
 *
 * The backend persists error_message starting with "SUBMIT_UNCERTAIN:"
 * when the paid request may have been accepted by the provider but
 * providerJobId could not be saved. This function returns true for that
 * case so the UI can show a distinct "manual review" warning instead of
 * a normal failure (which would mislead the user into retrying and
 * paying again).
 *
 * Detection order:
 *   1. Explicit `submitUncertain: true` flag (future API field).
 *   2. Error message starts with or contains "SUBMIT_UNCERTAIN" (case-insensitive).
 *   3. Recovered-from-restart marker "SUBMIT_UNCERTAIN (recovery)".
 */
export function isSubmitUncertain(job: ProductionJobLike | null | undefined): boolean {
  if (!job) return false;
  if (job.submitUncertain === true) return true;
  const msg = job.error || "";
  return /submit_uncertain/i.test(msg);
}

/**
 * A user-facing "action label" for a job's status badge. For SUBMIT_UNCERTAIN
 * we override the raw status so it never looks like a normal failure.
 */
export function jobStatusBadge(job: ProductionJobLike | null | undefined): {
  label: string;
  tone: "amber" | "green" | "red" | "blue" | "gray";
} {
  if (isSubmitUncertain(job)) return { label: "⚠ مراجعة يدوية", tone: "amber" };
  const s = job?.status || "pending";
  if (s === "completed") return { label: "completed", tone: "green" };
  if (s === "failed") return { label: "failed", tone: "red" };
  if (s === "processing") return { label: "processing", tone: "blue" };
  return { label: s, tone: "gray" };
}
