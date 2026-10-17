/**
 * KAYAN-TASK-59: Storage provider selection.
 *
 *   STORAGE_PROVIDER=local (default) → LocalProvider (files under uploads/)
 *   STORAGE_PROVIDER=r2              → R2Provider (NOT YET IMPLEMENTED in
 *                                      this task; requires Phase 4 + approval)
 *
 * The provider is created lazily so importing this module never performs I/O
 * and never requires R2 credentials.
 */
import { LocalProvider } from "./localProvider";
import { R2Provider } from "./r2Provider";
import { StorageError, assertSafeKey, type StorageProvider } from "./types";

export type { StorageProvider } from "./types";
export { StorageError, assertSafeKey } from "./types";

let _provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (_provider) return _provider;
  const which = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (which === "local") {
    _provider = new LocalProvider();
    return _provider;
  }
  if (which === "r2") {
    // KAYAN-TASK-67: R2Provider. Construction is lazy — missing env vars
    // surface as StorageError on first use, never silent fallback.
    _provider = new R2Provider();
    return _provider;
  }
  throw new StorageError(
    "INVALID_PROVIDER",
    `Unknown STORAGE_PROVIDER=${JSON.stringify(which)}. Expected 'local' or 'r2'.`,
  );
}

/** Test-only helper: reset the cached provider. */
export function _resetStorageForTests(): void {
  _provider = null;
}

// ================================================================
// KAYAN-TASK-73A': resolveStorageUrlToLocal
// ================================================================
/**
 * Given a storage URL produced by publicUrl() (either provider), obtain a
 * LOCAL filesystem path usable by FFmpeg/ffprobe. Returns a cleanup()
 * handle that is safe to call multiple times.
 *
 * Accepted URL shapes:
 *   - /uploads/<key>                (any provider; under r2 this is the
 *                                    migration path for pre-existing rows)
 *   - /api/storage/r2/<key>         (r2 provider only)
 *   - <R2_PUBLIC_BASE_URL>/<key>    (r2 provider only)
 *
 * Rejected: non-http(s) schemes, empty/whitespace, keys failing assertSafeKey.
 *
 * IMPORTANT: r2Provider.localPath() currently downloads the whole object
 * into memory (Buffer) before writing to a temp file. For very large videos
 * this is a memory concern, noted as a known limitation.
 */
export interface ResolvedLocalPath {
  readonly path: string;
  readonly wasRemote: boolean;
  cleanup: () => Promise<void>;
}

export async function resolveStorageUrlToLocal(url: unknown): Promise<ResolvedLocalPath> {
  if (typeof url !== "string") {
    throw new StorageError("INVALID_URL", "resolveStorageUrlToLocal: url must be a string");
  }
  const u = url.trim();
  if (u.length === 0) {
    throw new StorageError("INVALID_URL", "resolveStorageUrlToLocal: url is empty");
  }

  // Reject explicit non-http schemes early (javascript:, data:, file:, etc.)
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new StorageError("INVALID_URL", `scheme not allowed: ${scheme}:`);
    }
  }

  const provider = getStorage();
  const providerName = provider.name;

  let key: string | null = null;
  let wasRemote = false;

  if (u.startsWith("/uploads/")) {
    // Accept under both providers. Under r2, this is the migration path
    // for DB rows that predate the R2 switch.
    key = u.slice("/uploads/".length);
    wasRemote = providerName !== "local";
  } else if (u.startsWith("/api/storage/r2/")) {
    if (providerName !== "r2") {
      throw new StorageError(
        "INVALID_URL",
        "resolveStorageUrlToLocal: /api/storage/r2/ URL but STORAGE_PROVIDER is not r2",
      );
    }
    key = u.slice("/api/storage/r2/".length);
    wasRemote = true;
  } else if (schemeMatch && (schemeMatch[1].toLowerCase() === "http" || schemeMatch[1].toLowerCase() === "https")) {
    const base = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    if (!base || providerName !== "r2") {
      throw new StorageError(
        "INVALID_URL",
        "resolveStorageUrlToLocal: external http(s) URL without matching R2_PUBLIC_BASE_URL config",
      );
    }
    if (!u.startsWith(base + "/")) {
      throw new StorageError(
        "INVALID_URL",
        "resolveStorageUrlToLocal: http(s) URL is not under configured R2_PUBLIC_BASE_URL",
      );
    }
    key = u.slice(base.length + 1);
    wasRemote = true;
  } else {
    throw new StorageError("INVALID_URL", `unsupported URL shape: ${u.slice(0, 60)}`);
  }

  if (!key) {
    throw new StorageError("INVALID_URL", "could not extract storage key");
  }
  // Rejects traversal, absolute keys, empty segments, backslashes, NUL.
  assertSafeKey(key);

  let localPath: string;
  try {
    localPath = await provider.localPath(key);
  } catch (err) {
    if (err instanceof StorageError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new StorageError("RESOLVE_FAILED", `failed to resolve ${key}: ${msg}`);
  }

  // Defense in depth: reject empty path from a misbehaving provider.
  if (typeof localPath !== "string" || localPath.length === 0) {
    throw new StorageError("RESOLVE_FAILED", "provider returned empty local path");
  }

  let cleaned = false;
  return {
    path: localPath,
    wasRemote,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      try {
        await provider.cleanup(localPath);
      } catch {
        // never throw from cleanup
      }
    },
  };
}
