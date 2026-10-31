/**
 * KAYAN-TASK-44: Supabase Storage provider.
 *
 * Lazy: constructing SupabaseProvider does NOT touch the network. The
 * Supabase client is created on first use. Missing env vars → explicit
 * StorageError, never silent fallback to local.
 *
 * Required env vars (when STORAGE_PROVIDER=supabase):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (must be the LEGACY service_role JWT — not sb_secret_*)
 *   SUPABASE_BUCKET
 *
 * Notes / design constraints:
 *   - Bucket is private by default. publicUrl() returns an API proxy path
 *     "/api/storage/supabase/<key>" — never a public bucket URL.
 *   - Supabase free tier enforces a 50 MB per-file cap at the bucket level.
 *     Uploads larger than that will be rejected by Supabase (WRITE_FAILED).
 *   - writeFromFile reads the file into memory then uploads; callers that
 *     need true streaming must handle chunked uploads themselves (out of scope).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { StorageError, assertSafeKey, type StorageProvider } from "./types";

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

function readConfig(): SupabaseConfig {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = (process.env.SUPABASE_BUCKET || "").trim();
  if (!url || !key || !bucket) {
    throw new StorageError(
      "SUPABASE_CONFIG_MISSING",
      "Supabase storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET",
    );
  }
  return { url, serviceRoleKey: key, bucket };
}

export class SupabaseProvider implements StorageProvider {
  readonly name = "supabase" as const;
  private client: SupabaseClient | null = null;
  private cfg: SupabaseConfig | null = null;
  private tempDir: string | null = null;

  private ensureClient(): { client: SupabaseClient; cfg: SupabaseConfig } {
    if (this.client && this.cfg) return { client: this.client, cfg: this.cfg };
    const cfg = readConfig();
    this.client = createClient(cfg.url, cfg.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.cfg = cfg;
    return { client: this.client, cfg };
  }

  private ensureTempDir(): string {
    if (this.tempDir && fs.existsSync(this.tempDir)) return this.tempDir;
    const base = path.join(os.tmpdir(), "kayan-supabase-tmp");
    fs.mkdirSync(base, { recursive: true });
    this.tempDir = base;
    return base;
  }

  async write(key: string, data: Buffer, contentType?: string): Promise<string> {
    assertSafeKey(key);
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new StorageError("INVALID_DATA", "write: data must be a non-empty Buffer");
    }
    const { client, cfg } = this.ensureClient();
    const { error } = await client.storage
      .from(cfg.bucket)
      .upload(key, data, {
        contentType: contentType || "application/octet-stream",
        upsert: true,
      });
    if (error) {
      throw new StorageError("WRITE_FAILED", `Supabase write failed for ${key}: ${error.message}`);
    }
    return this.publicUrl(key);
  }

  async read(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    const { data, error } = await client.storage.from(cfg.bucket).download(key);
    if (error) {
      if (/not.?found|NoSuchKey/i.test(error.message)) {
        throw new StorageError("NOT_FOUND", `Supabase object not found: ${key}`);
      }
      throw new StorageError("READ_FAILED", `Supabase read failed for ${key}: ${error.message}`);
    }
    if (!data) {
      throw new StorageError("NOT_FOUND", `Supabase returned no body for ${key}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    // Use download with a HEAD-ish approach: list prefix of the exact key.
    // list() with the full key path returns the file entry if it exists.
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const basename = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const { data, error } = await client.storage.from(cfg.bucket).list(dir, {
      search: basename,
      limit: 100,
    });
    if (error) return false;
    return (data ?? []).some((row) => row.name === basename);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    const { error } = await client.storage.from(cfg.bucket).remove([key]);
    if (error) {
      if (/not.?found|NoSuchKey/i.test(error.message)) return;
      throw new StorageError("DELETE_FAILED", `Supabase delete failed for ${key}: ${error.message}`);
    }
  }

  async localPath(key: string): Promise<string> {
    assertSafeKey(key);
    const dir = this.ensureTempDir();
    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const localFile = path.join(dir, `${randomUUID()}_${safeName}`);
    const buf = await this.read(key);
    fs.writeFileSync(localFile, buf);
    return localFile;
  }

  async cleanup(localPath: string): Promise<void> {
    const dir = this.ensureTempDir();
    const resolved = path.resolve(localPath);
    if (!resolved.startsWith(dir + path.sep)) return;
    try { fs.unlinkSync(resolved); } catch {}
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    // Bucket is private → proxy through the app. The app is responsible
    // for serving GET /api/storage/supabase/<key>.
    return `/api/storage/supabase/${key}`;
  }

  /**
   * KAYAN-TASK-44: streaming upload from a local file. The Supabase SDK
   * accepts a Buffer, so we read the file into memory first. This is safe
   * given the 50 MB per-file cap on the free tier; larger files must be
   * resized/chunked by the caller.
   */
  async writeFromFile(
    localPath: string,
    key: string,
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    assertSafeKey(key);
    if (!localPath || typeof localPath !== "string") {
      throw new StorageError("INVALID_DATA", "writeFromFile: localPath required");
    }
    if (signal?.aborted) {
      const err: any = new Error("writeFromFile: aborted before start");
      err.name = "AbortError";
      throw err;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(localPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("INVALID_DATA", `writeFromFile: cannot stat ${localPath}: ${msg}`);
    }
    if (!st.isFile() || st.size === 0) {
      throw new StorageError("INVALID_DATA", `writeFromFile: file empty or not a file: ${localPath}`);
    }
    const buf = fs.readFileSync(localPath);
    return this.write(key, buf, contentType);
  }

  async getSize(key: string): Promise<number | null> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const basename = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const { data, error } = await client.storage.from(cfg.bucket).list(dir, {
      search: basename,
      limit: 100,
    });
    if (error) return null;
    const row = (data ?? []).find((r) => r.name === basename);
    if (!row) return null;
    const meta = (row as any).metadata;
    const size = meta?.size ?? meta?.contentLength;
    return typeof size === "number" && Number.isFinite(size) ? size : null;
  }

  async getSignedUploadUrl(key: string, options?: { upsert?: boolean }): Promise<{ signedUrl: string; token: string; path: string }> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    const { data, error } = await client.storage.from(cfg.bucket).createSignedUploadUrl(key, options);
    if (error || !data?.signedUrl) {
      throw new StorageError("SIGN_FAILED", `Supabase sign upload failed for ${key}: ${error?.message ?? "no signedUrl"}`);
    }
    return { signedUrl: data.signedUrl, token: data.token, path: data.path };
  }

  async getSignedUrl(
    key: string,
    expiresInSec: number,
  ): Promise<{ url: string; expiresAt: number | null }> {
    assertSafeKey(key);
    const ttl = Math.max(60, Math.min(3600, Math.floor(expiresInSec)));
    const { client, cfg } = this.ensureClient();
    const { data, error } = await client.storage.from(cfg.bucket).createSignedUrl(key, ttl);
    if (error || !data?.signedUrl) {
      throw new StorageError(
        "SIGN_FAILED",
        `Supabase sign failed for ${key}: ${error?.message ?? "no signedUrl"}`,
      );
    }
    return { url: data.signedUrl, expiresAt: Date.now() + ttl * 1000 };
  }
}
