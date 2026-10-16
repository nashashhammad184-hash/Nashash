#!/usr/bin/env tsx
/**
 * KAYAN-TASK-70/85: R2 migration tool.
 *
 * Hardening (TASK-85):
 *   - voice/ included in default subdirs.
 *   - Checkpoint-based resume (SHA-256 verified before marking done).
 *   - Per-operation timeout + bounded retry with exponential backoff.
 *   - Streaming hash (no full readFileSync for hashing).
 *   - Streaming upload via provider.writeFromFile when available.
 *   - Verify by downloading via provider.localPath + re-hashing.
 *   - Corrupted checkpoint lines are skipped, not fatal.
 *   - Dry-run (default) never uploads and never touches the checkpoint.
 *   - Source files are NEVER deleted.
 *
 * CLI:
 *   pnpm exec tsx scripts/r2-migrate.mts                    # dry-run inventory
 *   pnpm exec tsx scripts/r2-migrate.mts --execute          # real upload
 *   pnpm exec tsx scripts/r2-migrate.mts --execute --reset-checkpoint
 *   pnpm exec tsx scripts/r2-migrate.mts --source <dir> --checkpoint <file>
 *   pnpm exec tsx scripts/r2-migrate.mts --retry 5 --timeout 120000
 *   pnpm exec tsx scripts/r2-migrate.mts --execute --prefix staging-20261013/
 *
 * --prefix <str>  Optional key prefix applied to every uploaded key
 *                 (e.g. "staging-20261013/" -> keys become
 *                 "staging-20261013/videos/x.mp4"). Leading/trailing
 *                 slashes are normalized. When omitted, keys are placed
 *                 at the bucket root exactly as before (default behavior
 *                 is unchanged). The same prefixed key is used for
 *                 upload, SHA-256 verify, checkpoint, and resume.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { R2Provider } from "../src/lib/storage/r2Provider";

// ================================================================
// Types
// ================================================================
export interface MigrationOptions {
  sourceDir: string;
  checkpointPath: string;
  execute: boolean;
  resetCheckpoint: boolean;
  retryCount: number;
  timeoutMs: number;
  subdirs?: readonly string[];
  /** Optional key prefix applied to every uploaded key (e.g. "staging-20261013/"). Empty/undefined preserves current behavior. */
  keyPrefix?: string;
  log?: (msg: string) => void;
  /** StorageProvider-compatible object (mockable in tests). */
  provider: any;
  /** KAYAN-TASK-87: optional lock path. null disables locking (for tests). */
  lockPath?: string | null;
}

export interface MigrationSummary {
  scanned: number;
  bytes: number;
  uploaded: number;
  skipped: number;
  failed: number;
  failedKeys: string[];
  mode: "DRY-RUN" | "EXECUTE";
  elapsedMs: number;
}

export interface CheckpointEntry {
  key: string;
  size: number;
  sha256: string;
  at: string;
}

// ================================================================
// Constants
// ================================================================
export const DEFAULT_SUBDIRS = [
  "videos",
  "audio",
  "voice",
  "renders",
  "subtitles",
  "actors/refs",
  "canonical_faces",
] as const;

const EXCLUDED_EXTENSIONS = [".appimage", ".html", ".htm"];
const EXCLUDED_BASENAMES = ["kayan-studio-app.appimage"];

const DEFAULT_CHECKPOINT_FILENAME = ".r2-migrate.checkpoint.jsonl";
const DEFAULT_RETRY = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BACKOFF_BASE_MS = 1_000;

// ================================================================
// Helpers
// ================================================================
export function isExcluded(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXCLUDED_BASENAMES.includes(lower)) return true;
  for (const ext of EXCLUDED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/** Streaming SHA-256 — never loads the whole file into memory. */
export async function sha256OfFile(
  filePath: string,
): Promise<{ hash: string; size: number }> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    let size = 0;
    const s = fs.createReadStream(filePath);
    s.on("data", (chunk) => {
      h.update(chunk as Buffer);
      size += (chunk as Buffer).length;
    });
    s.on("end", () => resolve({ hash: h.digest("hex"), size }));
    s.on("error", reject);
  });
}

export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * KAYAN-TASK-87: true cancellation via AbortController.
 * `fn` receives a signal and MUST propagate it to the underlying operation.
 */
export async function withCancelableTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const te: any = new Error(`TIMEOUT after ${ms}ms: ${label}`);
      te.code = "TIMEOUT";
      te.name = "TimeoutError";
      reject(te);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } catch (e: any) {
    // KAYAN-TASK-87: if signal was aborted, normalize to TIMEOUT regardless
    // of which promise rejected first (fn's AbortError vs timeout).
    if (controller.signal.aborted) {
      const te: any = new Error(`TIMEOUT after ${ms}ms: ${label}`);
      te.code = "TIMEOUT";
      te.name = "TimeoutError";
      throw te;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  log: (m: string) => void,
): Promise<T> {
  // KAYAN-TASK-87: maxRetries = retries AFTER first attempt.
  //   maxRetries=0 -> 1 total attempt.
  //   maxRetries=3 -> up to 4 total attempts.
  const totalAttempts = Math.max(0, maxRetries) + 1;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < totalAttempts) {
    try {
      return await fn();
    } catch (e) {
      // KAYAN-TASK-87: timeouts are not retryable (network state unknown).
      if ((e as any)?.code === "TIMEOUT") throw e;
      lastErr = e;
      attempt++;
      if (attempt >= totalAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      log(`retry ${attempt}/${maxRetries} in ${delay}ms: ${(e as any)?.message ?? e}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function loadCheckpoint(
  checkpointPath: string,
): Map<string, CheckpointEntry> {
  const map = new Map<string, CheckpointEntry>();
  if (!fs.existsSync(checkpointPath)) return map;
  let raw: string;
  try {
    raw = fs.readFileSync(checkpointPath, "utf-8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t);
      if (
        typeof j?.key === "string" &&
        typeof j?.size === "number" &&
        typeof j?.sha256 === "string"
      ) {
        map.set(j.key, {
          key: j.key,
          size: j.size,
          sha256: j.sha256,
          at: typeof j.at === "string" ? j.at : "",
        });
      }
    } catch {
      // Corrupted line — skip silently, don't crash.
    }
  }
  return map;
}

export function appendCheckpoint(
  checkpointPath: string,
  entry: CheckpointEntry,
): void {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.appendFileSync(checkpointPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * KAYAN-TASK-87: safe resetCheckpoint.
 * Refuses to delete anything inside sourceDir, any path whose basename does
 * not contain "checkpoint", directories, and symlinks pointing into source.
 */
export type ResetResult =
  | { ok: true; deleted: boolean; reason?: string }
  | { ok: false; error: string };

export function resetCheckpoint(checkpointPath: string, sourceDir?: string): ResetResult {
  const resolved = path.resolve(checkpointPath);
  const srcResolved = sourceDir ? path.resolve(sourceDir) : null;
  const srcWithSep = srcResolved
    ? (srcResolved.endsWith(path.sep) ? srcResolved : srcResolved + path.sep)
    : null;
  if (srcResolved && srcWithSep) {
    if (resolved === srcResolved || resolved.startsWith(srcWithSep)) {
      return { ok: false, error: `refusing to delete ${resolved}: inside source directory ${srcResolved}` };
    }
  }
  if (!fs.existsSync(resolved)) {
    return { ok: true, deleted: false, reason: "file did not exist" };
  }
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (e: any) {
    return { ok: false, error: `cannot lstat ${resolved}: ${e?.message ?? e}` };
  }
  if (lstat.isDirectory()) {
    return { ok: false, error: `refusing to delete directory ${resolved}` };
  }
  if (srcResolved && srcWithSep) {
    try {
      const real = fs.realpathSync(resolved);
      if (real === srcResolved || real.startsWith(srcWithSep)) {
        return { ok: false, error: `refusing to delete ${resolved}: symlink target ${real} is inside source` };
      }
    } catch { /* realpath failed; treat as non-symlink */ }
  }
  try {
    fs.unlinkSync(resolved);
    return { ok: true, deleted: true };
  } catch (e: any) {
    return { ok: false, error: `unlink failed for ${resolved}: ${e?.message ?? e}` };
  }
}

// ================================================================
// KAYAN-TASK-87: process lock (prevents concurrent migration runs).
// ================================================================
export interface LockHandle {
  readonly lockPath: string;
  readonly ownerToken: string;
  readonly released: boolean;
  release: () => void;
}
export interface LockInfo {
  pid: number;
  startedAt: string;
  hostname: string;
  sourceDir: string;
  checkpointPath: string;
  ownerToken: string;
}
export type AcquireLockResult =
  | { ok: true; handle: LockHandle }
  | { ok: false; error: string };

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

export function acquireLock(
  lockPath: string,
  info: Omit<LockInfo, "pid" | "startedAt" | "hostname" | "ownerToken">,
): AcquireLockResult {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const myToken = crypto.randomUUID();
  const myInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    sourceDir: info.sourceDir,
    checkpointPath: info.checkpointPath,
    ownerToken: myToken,
  };

  const tryWrite = (): AcquireLockResult => {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, JSON.stringify(myInfo));
      fs.closeSync(fd);
      let released = false;
      const handle: LockHandle = {
        lockPath,
        ownerToken: myToken,
        get released() { return released; },
        release: () => {
          if (released) return;
          released = true;
          releaseLock(lockPath, myToken);
        },
      };
      return { ok: true, handle };
    } catch (e: any) {
      if (e?.code === "EEXIST") return { ok: false, error: "EEXIST" };
      return { ok: false, error: `cannot write lock ${lockPath}: ${e?.message ?? e}` };
    }
  };

  const first = tryWrite();
  if (first.ok) return first;
  if (first.error !== "EEXIST") return first;

  let existing: LockInfo | null = null;
  try {
    existing = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  } catch {
    existing = null;
  }

  if (!existing || typeof existing.pid !== "number" || typeof (existing as any).ownerToken !== "string") {
    return {
      ok: false,
      error:
        `lock file ${lockPath} exists but is unreadable/corrupt. ` +
        `Manual intervention required: inspect and remove it if no other run is active.`,
    };
  }

  // KAYAN-TASK-89: hostname mismatch -> REFUSE unconditionally.
  if (existing.hostname !== os.hostname()) {
    return {
      ok: false,
      error:
        `lock file ${lockPath} was created on a different host ` +
        `(hostname=${existing.hostname}, pid=${existing.pid}, started=${existing.startedAt}). ` +
        `Refusing to auto-recover. Manual intervention required.`,
    };
  }

  if (isPidAlive(existing.pid)) {
    return {
      ok: false,
      error:
        `another migration is already running on this host (pid=${existing.pid}, ` +
        `started=${existing.startedAt}). Refusing to start.`,
    };
  }

  // KAYAN-TASK-89: stale lock on SAME host with DEAD pid. Auto-recovery is
  // disabled because check-then-unlink is not atomic (another process may
  // create a fresh lock between read and unlink). Manual cleanup required.
  return {
    ok: false,
    error:
      `stale lock on this host: pid=${existing.pid} is not running. ` +
      `Auto-recovery is disabled to avoid deleting a fresh lock from a ` +
      `concurrent process. Manual intervention: verify no other migration ` +
      `is running, then remove ${lockPath} and retry.`,
  };
}

export function releaseLock(lockPath: string, ownerToken: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf-8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return;
    console.warn(`[MIGRATE] lock release: cannot read ${lockPath}: ${e?.message ?? e}`);
    return;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `[MIGRATE] lock release: ${lockPath} is corrupt; refusing to delete. Manual intervention required.`,
    );
    return;
  }
  if (!parsed || typeof parsed.ownerToken !== "string") {
    console.warn(`[MIGRATE] lock release: ${lockPath} has no ownerToken; refusing to delete.`);
    return;
  }
  if (parsed.ownerToken !== ownerToken) {
    console.warn(
      `[MIGRATE] lock release: ${lockPath} is now owned by a different token; refusing to delete.`,
    );
    return;
  }
  try {
    fs.unlinkSync(lockPath);
  } catch (e: any) {
    if (e?.code === "ENOENT") return;
    console.warn(`[MIGRATE] lock release: unlink failed for ${lockPath}: ${e?.message ?? e}`);
  }
}

function guessContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".srt") return "application/x-subrip; charset=utf-8";
  if (ext === ".vtt") return "text/vtt; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

// ================================================================
// Core migration
// ================================================================
export async function runMigration(
  opts: MigrationOptions,
): Promise<MigrationSummary> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const subdirs = opts.subdirs ?? DEFAULT_SUBDIRS;
  // KAYAN-TASK-92: optional key prefix. Normalized to "a/b/" form or "".
  const _rawPrefix = (opts.keyPrefix ?? "").trim();
  const keyPrefix = _rawPrefix === ""
    ? ""
    : _rawPrefix.replace(/^\/+/, "").replace(/\/+$/, "") + "/";
  const startedAt = Date.now();

  let lockHandle: LockHandle | null = null;
  const lockPath = opts.lockPath === null
    ? null
    : (opts.lockPath ?? path.resolve(opts.checkpointPath + ".lock"));

  if (opts.execute && lockPath) {
    const r = acquireLock(lockPath, {
      sourceDir: opts.sourceDir,
      checkpointPath: opts.checkpointPath,
    });
    if (!r.ok) {
      log(`[MIGRATE] REFUSED: ${r.error}`);
      throw new Error(`migration refused: ${r.error}`);
    }
    lockHandle = r.handle;
    log(`[MIGRATE] lock acquired: ${lockPath}`);
  }

  try {
    if (opts.execute && opts.resetCheckpoint) {
      const res = resetCheckpoint(opts.checkpointPath, opts.sourceDir);
      if (!res.ok) {
        log(`[MIGRATE] REFUSED reset: ${res.error}`);
        throw new Error(`resetCheckpoint refused: ${res.error}`);
      }
      if (res.deleted) log(`[MIGRATE] checkpoint reset: ${opts.checkpointPath}`);
      else log(`[MIGRATE] checkpoint reset skipped: ${res.reason ?? ""}`);
    }
    if (!opts.execute && opts.resetCheckpoint) {
      log(`[MIGRATE] WARNING: --reset-checkpoint requested but IGNORED in DRY-RUN (no files deleted).`);
    }
    const checkpoint = opts.execute
      ? loadCheckpoint(opts.checkpointPath)
      : new Map<string, CheckpointEntry>();

  const summary: MigrationSummary = {
    scanned: 0,
    bytes: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    failedKeys: [],
    mode: opts.execute ? "EXECUTE" : "DRY-RUN",
    elapsedMs: 0,
  };

  for (const sub of subdirs) {
    const dir = path.join(opts.sourceDir, sub);
    if (!fs.existsSync(dir)) {
      log(`[MIGRATE] skip missing dir: ${sub}/`);
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e: any) {
      log(`[MIGRATE] cannot read ${sub}/: ${e?.message ?? e}`);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (isExcluded(ent.name)) {
        log(`[MIGRATE] skip excluded file: ${sub}/${ent.name}`);
        continue;
      }
      const fullPath = path.join(dir, ent.name);
      const relKey = `${sub}/${ent.name}`;
      const key = keyPrefix ? `${keyPrefix}${relKey}` : relKey;

      let hashInfo: { hash: string; size: number };
      try {
        hashInfo = await sha256OfFile(fullPath);
      } catch (e: any) {
        log(`[MIGRATE] FAIL (hash) ${key}: ${e?.message ?? e}`);
        summary.failed++;
        summary.failedKeys.push(key);
        continue;
      }

      summary.scanned++;
      summary.bytes += hashInfo.size;
      log(`[MIGRATE] ${key}  size=${hashInfo.size}  sha256=${hashInfo.hash.slice(0, 16)}…`);

      if (!opts.execute) {
        summary.skipped++;
        continue;
      }

      const prior = checkpoint.get(key);
      if (
        prior &&
        prior.size === hashInfo.size &&
        prior.sha256 === hashInfo.hash
      ) {
        log(`[MIGRATE] SKIP (checkpoint-verified) ${key}`);
        summary.skipped++;
        continue;
      }

      const contentType = guessContentType(ent.name);

      try {
        await withRetry(
          async () => {
            // 1. Upload (streaming when provider supports it).
            if (typeof opts.provider.writeFromFile === "function") {
              await withCancelableTimeout(
                (signal) => opts.provider.writeFromFile(fullPath, key, contentType, signal),
                opts.timeoutMs,
                `upload ${key}`,
              );
            } else {
              const buf = fs.readFileSync(fullPath);
              await withTimeout(
                opts.provider.write(key, buf, contentType),
                opts.timeoutMs,
                `upload ${key}`,
              );
            }

            // 2. Verify by downloading through provider.localPath.
            const downloaded = await withTimeout(
              opts.provider.localPath(key),
              opts.timeoutMs,
              `verify-download ${key}`,
            );
            let remoteHash: string;
            try {
              const r = await sha256OfFile(downloaded);
              remoteHash = r.hash;
            } finally {
              try {
                await opts.provider.cleanup(downloaded);
              } catch {
                /* ignore */
              }
            }
            if (remoteHash !== hashInfo.hash) {
              throw new Error(
                `SHA256 mismatch: local=${hashInfo.hash} remote=${remoteHash}`,
              );
            }
          },
          opts.retryCount,
          DEFAULT_BACKOFF_BASE_MS,
          log,
        );

        const entry: CheckpointEntry = {
          key,
          size: hashInfo.size,
          sha256: hashInfo.hash,
          at: new Date().toISOString(),
        };
        appendCheckpoint(opts.checkpointPath, entry);
        checkpoint.set(key, entry);
        log(`[MIGRATE] OK ${key}`);
        summary.uploaded++;
      } catch (e: any) {
        const msg = e?.code === "TIMEOUT"
          ? `upload timed out for ${key}: no automatic retry after timeout`
          : (e?.message ?? String(e));
        log(`[MIGRATE] FAIL ${key}: ${msg}`);
        summary.failed++;
        summary.failedKeys.push(key);
      }
    }
  }

    summary.elapsedMs = Date.now() - startedAt;
    return summary;
  } finally {
    if (lockHandle) {
      lockHandle.release();
      log(`[MIGRATE] lock released: ${lockHandle.lockPath}`);
    }
  }
}

// ================================================================
// CLI entry — only runs when the script is invoked directly.
// ================================================================
async function cli(): Promise<void> {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute");
  const resetCheckpoint = argv.includes("--reset-checkpoint");
  const getArg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const sourceDir =
    getArg("--source") ?? path.resolve(process.cwd(), "uploads");
  const checkpointPath =
    getArg("--checkpoint") ??
    path.resolve(process.cwd(), "..", "..", DEFAULT_CHECKPOINT_FILENAME);
  const retryRaw = Number(getArg("--retry") ?? DEFAULT_RETRY);
  const timeoutRaw = Number(getArg("--timeout") ?? DEFAULT_TIMEOUT_MS);
  // KAYAN-TASK-92: optional key prefix.
  const keyPrefixRaw = getArg("--prefix");
  const retryCount =
    Number.isFinite(retryRaw) && retryRaw >= 0 ? Math.floor(retryRaw) : DEFAULT_RETRY;
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : DEFAULT_TIMEOUT_MS;

  console.log(`[MIGRATE] source=${sourceDir}`);
  console.log(`[MIGRATE] checkpoint=${checkpointPath}`);
  console.log(`[MIGRATE] mode=${execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`[MIGRATE] retry=${retryCount} timeout=${timeoutMs}ms`);
  console.log(`[MIGRATE] keyPrefix=${keyPrefixRaw ? JSON.stringify(keyPrefixRaw) : "(none)"}`);

  if (execute) {
    const sp = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
    if (sp !== "r2") {
      console.error(
        "[MIGRATE] refusing --execute: STORAGE_PROVIDER must be 'r2'.",
      );
      process.exit(1);
    }
  }

  const provider = execute ? new R2Provider() : (null as any);

  const summary = await runMigration({
    sourceDir,
    checkpointPath,
    execute,
    resetCheckpoint,
    retryCount,
    timeoutMs,
    provider,
    keyPrefix: keyPrefixRaw,
  });

  console.log("\n=== MIGRATION SUMMARY ===");
  console.log(`Mode:      ${summary.mode}`);
  console.log(`Scanned:   ${summary.scanned}`);
  console.log(`Bytes:     ${summary.bytes}`);
  console.log(`Uploaded:  ${summary.uploaded}`);
  console.log(`Skipped:   ${summary.skipped}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Elapsed:   ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  console.log("Source files were NOT deleted.");

  if (summary.failed > 0) process.exit(1);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("r2-migrate.mts");
if (invokedDirectly) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
