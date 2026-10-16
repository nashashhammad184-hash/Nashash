/**
 * KAYAN-TASK-67: Cloudflare R2 storage provider (S3-compatible).
 *
 * Lazy: constructing R2Provider does NOT touch the network. The S3 client
 * is created on first use. Missing env vars → explicit StorageError, never
 * silent fallback to local.
 *
 * Required env vars (when STORAGE_PROVIDER=r2):
 *   R2_ACCOUNT_ID
 *   R2_BUCKET
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *
 * Optional:
 *   R2_ENDPOINT (defaults to https://<account>.r2.cloudflarestorage.com)
 *   R2_PUBLIC_BASE_URL (if set, publicUrl() returns <base>/<key>; otherwise
 *                       returns an API path /api/storage/r2/<key> that must
 *                       be proxied by the app — never a public bucket URL)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
// KAYAN-TASK-73G: streaming + timeouts for large files.
import { Readable, PassThrough } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { StorageError, assertSafeKey, type StorageProvider } from "./types";

interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl?: string;
}

function readConfig(): R2Config {
  const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
  const bucket = (process.env.R2_BUCKET || "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageError(
      "R2_CONFIG_MISSING",
      "R2 storage requires R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }
  const endpoint = (process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).trim();
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").trim() || undefined;
  return { accountId, bucket, accessKeyId, secretAccessKey, endpoint, publicBaseUrl };
}

export class R2Provider implements StorageProvider {
  readonly name = "r2" as const;
  private client: S3Client | null = null;
  private cfg: R2Config | null = null;
  private tempDir: string | null = null;

  private ensureClient(): { client: S3Client; cfg: R2Config } {
    if (this.client && this.cfg) return { client: this.client, cfg: this.cfg };
    const cfg = readConfig();
    // KAYAN-TASK-73G: explicit connection/request timeouts so a hung R2
    // socket cannot stall the process indefinitely.
    const connectionTimeoutMs = Number(process.env.R2_CONNECT_TIMEOUT_MS || "10000");
    const requestTimeoutMs = Number(process.env.R2_REQUEST_TIMEOUT_MS || "300000");
    const client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: Number.isFinite(connectionTimeoutMs) ? connectionTimeoutMs : 10000,
        requestTimeout: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : 300000,
      }),
      // Retry only on transient errors. Non-idempotent ops (PutObject) are
      // safe to retry with the same key + same bytes.
      maxAttempts: 3,
    });
    this.client = client;
    this.cfg = cfg;
    return { client, cfg };
  }

  private ensureTempDir(): string {
    if (this.tempDir && fs.existsSync(this.tempDir)) return this.tempDir;
    const base = path.join(os.tmpdir(), "kayan-r2-tmp");
    fs.mkdirSync(base, { recursive: true });
    this.tempDir = base;
    return base;
  }

  async write(key: string, data: Buffer, contentType?: string): Promise<string> {
    assertSafeKey(key);
    if (!Buffer.isBuffer(data)) {
      throw new StorageError("INVALID_DATA", "write: data must be a Buffer");
    }
    const { client, cfg } = this.ensureClient();
    try {
      await client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: data,
        ContentType: contentType || "application/octet-stream",
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("WRITE_FAILED", `R2 write failed for ${key}: ${msg}`);
    }
    return this.publicUrl(key);
  }

  async read(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!res.Body) throw new StorageError("NOT_FOUND", `R2 object has no body: ${key}`);
      const chunks: Buffer[] = [];
      const stream = res.Body as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        throw new StorageError("NOT_FOUND", `R2 object not found: ${key}`);
      }
      if (err instanceof StorageError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("READ_FAILED", `R2 read failed for ${key}: ${msg}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return true;
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404) return;
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("DELETE_FAILED", `R2 delete failed for ${key}: ${msg}`);
    }
  }

  async localPath(key: string): Promise<string> {
    assertSafeKey(key);
    const dir = this.ensureTempDir();
    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const localFile = path.join(dir, `${randomUUID()}_${safeName}`);
    const { client, cfg } = this.ensureClient();
    let res;
    try {
      res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        throw new StorageError("NOT_FOUND", `R2 object not found: ${key}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("READ_FAILED", `R2 localPath failed for ${key}: ${msg}`);
    }
    if (!res.Body) {
      throw new StorageError("NOT_FOUND", `R2 object has no body: ${key}`);
    }
    // KAYAN-TASK-73G: stream directly to disk (no full in-memory Buffer).
    // Cleanup partial file on any failure.
    let bytesWritten = 0;
    try {
      // Normalize: AWS SDK returns a Readable, but mocks may return any
      // async iterable. Readable.from handles both.
      const readStream = res.Body instanceof Readable
        ? (res.Body as Readable)
        : Readable.from(res.Body as any);
      const writeStream = fs.createWriteStream(localFile);
      readStream.on("data", (chunk: Buffer) => { bytesWritten += chunk.length; });
      await streamPipeline(readStream, writeStream);
    } catch (err) {
      try { fs.unlinkSync(localFile); } catch {}
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("READ_FAILED", `R2 localPath stream failed for ${key}: ${msg}`);
    }
    // Verify size on disk.
    let st: fs.Stats;
    try {
      st = fs.statSync(localFile);
    } catch (err) {
      try { fs.unlinkSync(localFile); } catch {}
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("READ_FAILED", `R2 localPath stat failed for ${key}: ${msg}`);
    }
    if (!st.isFile() || st.size === 0) {
      try { fs.unlinkSync(localFile); } catch {}
      throw new StorageError("READ_FAILED", `R2 localPath: empty/missing file for ${key}`);
    }
    if (st.size !== bytesWritten) {
      // Best-effort guard; s3 stream may split chunks but bytes count is
      // consistent with file size on disk.
      try { fs.unlinkSync(localFile); } catch {}
      throw new StorageError(
        "READ_FAILED",
        `R2 localPath: size mismatch for ${key} (wrote=${bytesWritten}, disk=${st.size})`,
      );
    }
    return localFile;
  }

  async cleanup(localPath: string): Promise<void> {
    // Only delete files inside our temp dir. Never touch real uploads.
    const dir = this.ensureTempDir();
    const resolved = path.resolve(localPath);
    if (!resolved.startsWith(dir + path.sep)) return;
    try { fs.unlinkSync(resolved); } catch {}
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    if (this.cfg?.publicBaseUrl || process.env.R2_PUBLIC_BASE_URL) {
      const base = (this.cfg?.publicBaseUrl || process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
      return `${base}/${key}`;
    }
    // No public base → return API proxy path. The application is responsible
    // for serving these via /api/storage/r2/<key> with proper auth.
    return `/api/storage/r2/${key}`;
  }

  /**
   * KAYAN-TASK-73J: streaming upload from a local file path. Uses
   * PutObjectCommand with a ReadStream body + ContentLength, avoiding a
   * full in-memory Buffer for large videos.
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
    if (signal?.aborted) {
      const err: any = new Error("writeFromFile: aborted before start");
      err.name = "AbortError";
      throw err;
    }
    const { client, cfg } = this.ensureClient();

    // KAYAN-TASK-92 (rev 2): decouple the fs read stream from the SDK via a
    // PassThrough. A direct fs->SDK pipe leaks fs read errors into internal
    // SDK streams that lack an 'error' listener mid-consumption, causing
    // "Unhandled 'error' event" (observed: mid-stream read failure). The
    // PassThrough gives one interception point for fs errors; we then abort
    // the request via a local AbortController so the SDK surfaces the failure
    // through send() instead of through an unconsumed stream.
    const readStream = fs.createReadStream(localPath);
    const bodyStream = new PassThrough();
    const internalAbort = new AbortController();

    // Merge caller signal with internal abort so either can cancel the PUT.
    const mergedSignal: AbortSignal = signal
      ? (AbortSignal as any).any([signal, internalAbort.signal])
      : internalAbort.signal;

    let streamError: Error | null = null;

    readStream.on("error", (err: Error) => {
      streamError = err;
      try { internalAbort.abort(); } catch {}
      try { bodyStream.destroy(); } catch {}
    });
    // Swallow PassThrough errors: they arise only from SDK-side abort/teardown.
    // The actionable error reaches the caller via the send() rejection path.
    bodyStream.on("error", () => {});

    // Forward bytes and end-of-stream from fs into the SDK body.
    readStream.pipe(bodyStream);

    // Caller abort: also tear down local streams (mergedSignal already
    // carries the caller's abort into the SDK request).
    const onCallerAbort = () => {
      try { readStream.destroy(); } catch {}
      try { bodyStream.destroy(); } catch {}
    };
    if (signal) signal.addEventListener("abort", onCallerAbort, { once: true });

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: bodyStream,
          ContentLength: st.size,
          ContentType: contentType || "application/octet-stream",
        }),
        { abortSignal: mergedSignal },
      );
    } catch (err) {
      // Best-effort teardown of both streams.
      try { readStream.destroy(); } catch {}
      try { bodyStream.destroy(); } catch {}

      const anyErr = err as any;

      // Prefer the original fs read error: it is the real cause and is more
      // actionable than the SDK's generic "UnknownError"/abort wrapper.
      if (streamError) {
        const m = streamError.message || String(streamError);
        throw new StorageError("WRITE_FAILED", `R2 writeFromFile failed for ${key}: ${m}`);
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (
        anyErr?.name === "AbortError" ||
        anyErr?.name === "TimeoutError" ||
        signal?.aborted
      ) {
        const abortErr: any = new Error(`R2 writeFromFile aborted for ${key}: ${msg}`);
        abortErr.name = "AbortError";
        throw abortErr;
      }
      throw new StorageError("WRITE_FAILED", `R2 writeFromFile failed for ${key}: ${msg}`);
    } finally {
      if (signal) signal.removeEventListener("abort", onCallerAbort);
    }
    return this.publicUrl(key);
  }

  /**
   * KAYAN-TASK-73J: remote object size via HeadObject. Returns null when
   * the object does not exist or size is unknown.
   */
  // KAYAN-TASK-79: short-lived signed URL for direct browser playback.
  // Uses @aws-sdk/s3-request-presigner when available (dynamically imported
  // so the app boots even if the package is absent in local mode).
  async getSignedUrl(key: string, expiresInSec: number): Promise<{ url: string; expiresAt: number | null }> {
    assertSafeKey(key);
    const ttl = Math.max(60, Math.min(3600, Math.floor(expiresInSec)));
    let presigner: any;
    try {
      presigner = await import("@aws-sdk/s3-request-presigner");
    } catch (e) {
      throw new StorageError("SIGNER_UNAVAILABLE", "s3-request-presigner not installed");
    }
    const { getSignedUrl } = presigner;
    const { client, cfg } = this.ensureClient();
    const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
    try {
      const url = await getSignedUrl(client, cmd, { expiresIn: ttl });
      return { url, expiresAt: Date.now() + ttl * 1000 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError("SIGN_FAILED", `R2 sign failed for ${key}: ${msg}`);
    }
  }

  async getSize(key: string): Promise<number | null> {
    assertSafeKey(key);
    const { client, cfg } = this.ensureClient();
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const len = (res as any).ContentLength;
      return typeof len === "number" && Number.isFinite(len) ? len : null;
    } catch {
      return null;
    }
  }
}
