/**
 * KAYAN-TASK-59: Local filesystem storage provider.
 *
 * Preserves the existing behavior of the codebase (files live under
 * `uploads/<key>`, URLs are `/uploads/<key>`). Adds path-traversal
 * protection via assertSafeKey() and publicUrl().
 */
import fs from "node:fs";
import path from "node:path";
import { StorageError, assertSafeKey, type StorageProvider } from "./types";

export class LocalProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = rootDir ?? path.resolve(process.cwd(), "uploads");
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const abs = path.resolve(this.root, key);
    // Defense in depth: confirm the resolved path stays under root.
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!abs.startsWith(rootWithSep) && abs !== this.root) {
      throw new StorageError("INVALID_KEY", `key escapes storage root: ${key}`);
    }
    return abs;
  }

  async write(key: string, data: Buffer, _contentType?: string): Promise<string> {
    if (!Buffer.isBuffer(data)) {
      throw new StorageError("INVALID_DATA", "write: data must be a Buffer");
    }
    const abs = this.resolve(key);
    const dir = path.dirname(abs);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.writeFile(abs, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("WRITE_FAILED", `failed to write ${key}: ${msg}`);
    }
    return this.publicUrl(key);
  }

  async read(key: string): Promise<Buffer> {
    const abs = this.resolve(key);
    try {
      return await fs.promises.readFile(abs);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new StorageError("NOT_FOUND", `storage key not found: ${key}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("READ_FAILED", `failed to read ${key}: ${msg}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const abs = this.resolve(key);
    try {
      const st = await fs.promises.stat(abs);
      return st.isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const abs = this.resolve(key);
    try {
      await fs.promises.unlink(abs);
    } catch (err: any) {
      if (err?.code === "ENOENT") return; // no-op
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("DELETE_FAILED", `failed to delete ${key}: ${msg}`);
    }
  }

  async localPath(key: string): Promise<string> {
    const abs = this.resolve(key);
    // Local provider: the file IS the local path. Verify existence so
    // FFmpeg and other consumers fail fast.
    const st = await fs.promises.stat(abs).catch(() => null);
    if (!st || !st.isFile()) {
      throw new StorageError("NOT_FOUND", `storage key not found: ${key}`);
    }
    return abs;
  }

  async cleanup(_localPath: string): Promise<void> {
    // No-op for local provider: file is the canonical copy, never delete.
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `/uploads/${key}`;
  }

  // KAYAN-TASK-73J: streaming not needed for local — copy file.
  async writeFromFile(
    localPath: string,
    key: string,
    _contentType?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    assertSafeKey(key);
    if (!localPath || typeof localPath !== "string") {
      throw new StorageError("INVALID_DATA", "writeFromFile: localPath required");
    }
    if (signal?.aborted) {
      const err: any = new Error("local writeFromFile: aborted before start");
      err.name = "AbortError";
      throw err;
    }
    const st = await fs.promises.stat(localPath).catch(() => null);
    if (!st || !st.isFile() || st.size === 0) {
      throw new StorageError("INVALID_DATA", `writeFromFile: source file invalid: ${localPath}`);
    }
    const abs = this.resolve(key);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    if (path.resolve(localPath) === abs) {
      return this.publicUrl(key);
    }
    // KAYAN-TASK-87: honor abort signal even for local copy.
    if (signal?.aborted) {
      const err: any = new Error("local writeFromFile: aborted");
      err.name = "AbortError";
      throw err;
    }
    try {
      await fs.promises.copyFile(localPath, abs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("WRITE_FAILED", `local writeFromFile failed for ${key}: ${msg}`);
    }
    return this.publicUrl(key);
  }

  // KAYAN-TASK-79: local provider has no signed URLs; return the static URL.
  async getSignedUrl(key: string, _expiresInSec: number): Promise<{ url: string; expiresAt: number | null }> {
    assertSafeKey(key);
    const st = await fs.promises.stat(this.resolve(key)).catch(() => null);
    if (!st || !st.isFile()) {
      throw new StorageError("NOT_FOUND", `storage key not found: ${key}`);
    }
    return { url: this.publicUrl(key), expiresAt: null };
  }

  async getSize(key: string): Promise<number | null> {
    const abs = this.resolve(key);
    try {
      const st = await fs.promises.stat(abs);
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  }
}
