/**
 * KAYAN-TASK-81: minimal auth client for the studio.
 *
 * SECURITY:
 *   - The token is never stored in localStorage/sessionStorage.
 *   - The session cookie is HttpOnly; JS cannot read it.
 *   - All requests use `credentials: "same-origin"` so the cookie flows.
 */

export interface SessionState {
  authenticated: boolean;
  source: "cookie" | "bearer" | null;
  expiresAt: number | null;
}

export async function fetchSession(): Promise<SessionState> {
  try {
    const r = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    if (!r.ok) return { authenticated: false, source: null, expiresAt: null };
    return (await r.json()) as SessionState;
  } catch {
    return { authenticated: false, source: null, expiresAt: null };
  }
}

export async function loginWithToken(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || token.length === 0) return { ok: false, error: "الرمز مطلوب" };
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, error: "الرمز غير صحيح" };
    if (r.status === 429) return { ok: false, error: "محاولات كثيرة. حاول لاحقًا." };
    if (r.status === 503) return { ok: false, error: "المصادقة غير مُهيّأة على الخادم" };
    return { ok: false, error: "تعذّر تسجيل الدخول" };
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالخادم" };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // best-effort
  }
}

/**
 * Request a short-lived signed URL for a storage key.
 * Returns null on any failure (caller decides whether to retry once).
 */
export async function fetchSignedUrl(
  key: string,
): Promise<{ url: string; expiresAt: number | null } | null> {
  try {
    const r = await fetch(
      `/api/storage/r2/sign?key=${encodeURIComponent(key)}`,
      { credentials: "same-origin" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { url: string; expiresAt: number | null };
    if (!j.url) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * Derive a storage key from a URL of the form /uploads/<key> or
 * /api/storage/r2/<key>. Returns null when the URL is not a storage URL.
 */
export function keyFromStorageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("/uploads/")) return url.slice("/uploads/".length);
  if (url.startsWith("/api/storage/r2/")) return url.slice("/api/storage/r2/".length);
  return null;
}
