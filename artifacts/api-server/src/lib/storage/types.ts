/**
 * KAYAN-TASK-59: Unified storage abstraction.
 *
 * Keys are relative paths WITHOUT leading "uploads/" — e.g. "audio/foo.mp3",
 * "videos/bar.mp4", "renders/baz.mp4". Providers translate keys to their
 * underlying storage (filesystem, R2, ...).
 */
export interface StorageProvider {
  readonly name: "local" | "r2" | "supabase";
  /** Write a buffer under key. Returns the public URL for serving. */
  write(key: string, data: Buffer, contentType?: string): Promise<string>;
  /** Read bytes for key. Throws if missing. */
  read(key: string): Promise<Buffer>;
  /** Check existence without reading the body. */
  exists(key: string): Promise<boolean>;
  /** Delete key. Missing key is a no-op. */
  delete(key: string): Promise<void>;
  /**
   * Return a path to a LOCAL file containing key's bytes. For local
   * provider this is the real file; for remote providers this downloads
   * to a temp directory. Caller MUST invoke cleanup() when done.
   */
  localPath(key: string): Promise<string>;
  /** Release any temp file created by localPath (no-op for local provider). */
  cleanup(localPath: string): Promise<void>;
  /** Public URL for serving the file (sync, no I/O). */
  publicUrl(key: string): string;
  /**
   * KAYAN-TASK-73J: optional streaming upload from a local file path.
   * Providers that support it should stream without buffering the entire
   * file in memory. Returns the public URL.
   */
  writeFromFile?(localPath: string, key: string, contentType?: string, signal?: AbortSignal): Promise<string>;
  /**
   * KAYAN-TASK-73J: optional remote size lookup (bytes). Returns null
   * if the provider cannot determine it or the object does not exist.
   */
  getSize?(key: string): Promise<number | null>;
  /**
   * KAYAN-TASK-79: optional short-lived signed URL for direct serving.
   * Local provider returns "/uploads/<key>" with null ttl.
   * Remote providers return a presigned URL with expiresIn seconds.
   * If not supported, throw StorageError("SIGNER_UNAVAILABLE", ...).
   */
  getSignedUrl?(key: string, expiresInSec: number): Promise<{ url: string; expiresAt: number | null }>;
}

export class StorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "StorageError";
  }
}

/**
 * Reject keys that could escape the storage root or reference the
 * filesystem in unsafe ways. Used by every provider.
 *
 * Rules:
 *   - non-empty string
 *   - no leading "/" (must be relative)
 *   - no ".." path segments
 *   - no NUL bytes
 *   - no Windows drive letters or backslashes
 */
export function assertSafeKey(key: string): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new StorageError("INVALID_KEY", "storage key must be a non-empty string");
  }
  if (key.includes("\0")) {
    throw new StorageError("INVALID_KEY", "storage key contains NUL byte");
  }
  if (key.startsWith("/")) {
    throw new StorageError("INVALID_KEY", "storage key must be relative (no leading slash)");
  }
  if (key.includes("\\")) {
    throw new StorageError("INVALID_KEY", "storage key must not contain backslashes");
  }
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === "." || seg.length === 0) {
      throw new StorageError("INVALID_KEY", `storage key contains unsafe segment: ${JSON.stringify(seg)}`);
    }
  }
  return key;
}
