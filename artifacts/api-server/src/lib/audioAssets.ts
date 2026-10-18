/**
 * KAYAN-TASK-46: audio asset persistence.
 * KAYAN-TASK-72: routed through the unified storage layer.
 *
 * Behavior:
 *   - STORAGE_PROVIDER=local (default): write to uploads/audio/<safe-name>.mp3,
 *     return url = /uploads/audio/<safe-name>.mp3  (identical to pre-TASK-72).
 *   - STORAGE_PROVIDER=r2: write via R2 provider, verify read-back, return
 *     the provider's publicUrl. `filePath` is "" under R2 (no local file).
 *
 * Tests may pass `baseDir` to isolate writes to a temp directory — in that
 * case a scoped LocalProvider is used regardless of STORAGE_PROVIDER.
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { LocalProvider } from "./storage/localProvider";
import { getStorage } from "./storage/index";
import type { StorageProvider } from "./storage/types";

export interface AudioSavedOk {
  readonly ok: true;
  readonly filePath: string;
  readonly url: string;
  readonly sizeBytes: number;
}
export interface AudioSaveError {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
}
export type AudioSaveResult = AudioSavedOk | AudioSaveError;

export function getAudioDir(baseDir?: string): string {
  const root = baseDir ?? process.cwd();
  const dir = path.resolve(root, "uploads", "audio");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function makeSafeAudioName(ext = ".mp3"): string {
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : ".mp3";
  return `audio_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${safeExt}`;
}

/**
 * Persist a Buffer as an audio asset and validate the result.
 * Refuses empty buffers. On local provider: exact prior behavior.
 * On remote providers: writes then reads back to verify size.
 */
export async function saveAudioBuffer(
  buf: Buffer,
  opts: { baseDir?: string; ext?: string } = {},
): Promise<AudioSaveResult> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 502, error: "audio buffer is empty" };
  }

  // Choose provider: `baseDir` (tests) forces a scoped LocalProvider;
  // otherwise the globally-configured provider (default = local).
  let provider: StorageProvider;
  try {
    provider = opts.baseDir
      ? new LocalProvider(path.join(opts.baseDir, "uploads"))
      : getStorage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: `failed to resolve storage provider: ${msg}` };
  }

  const filename = makeSafeAudioName(opts.ext);
  const key = `audio/${filename}`;

  if (provider.name === "local") {
    // Exact prior local behavior: fs write + stat validation.
    let dir: string;
    try {
      dir = getAudioDir(opts.baseDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: `failed to create audio dir: ${msg}` };
    }
    const filePath = path.join(dir, filename);
    try {
      fs.writeFileSync(filePath, buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: `failed to write audio file: ${msg}` };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 500, error: "audio file not found after write" };
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: `failed to stat audio file: ${msg}` };
    }
    if (!st.isFile() || st.size === 0) {
      return { ok: false, status: 500, error: `audio file is empty after write (size=${st.size})` };
    }
    if (st.size !== buf.length) {
      return {
        ok: false,
        status: 500,
        error: `audio file size mismatch: wrote ${buf.length}, on disk ${st.size}`,
      };
    }
    let publicUrl: string;
    try {
      publicUrl = provider.publicUrl(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: `invalid audio storage key: ${msg}` };
    }
    return { ok: true, filePath, url: publicUrl, sizeBytes: st.size };
  }

  // Remote provider (R2 or future): write + verify read-back.
  try {
    const url = await provider.write(key, buf, "audio/mpeg");
    const back = await provider.read(key);
    if (back.length !== buf.length) {
      return {
        ok: false,
        status: 500,
        error: `remote size mismatch after write: expected ${buf.length}, got ${back.length}`,
      };
    }
    // No local file under remote provider; filePath is empty.
    return { ok: true, filePath: "", url, sizeBytes: buf.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: `failed to save audio to remote storage: ${msg}` };
  }
}
