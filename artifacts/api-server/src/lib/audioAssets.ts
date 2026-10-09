/**
 * KAYAN-TASK-46: audio asset persistence.
 *
 * Extracted so tests can verify disk writes without touching Deepgram.
 * Same convention used by VOICE_GEN in productionEngine.ts:
 *   uploads/audio/<safe-name>.mp3  ->  /uploads/audio/<safe-name>.mp3
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

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
 * Persist a Buffer to uploads/audio/<safe-name> and validate the result.
 * Refuses empty buffers and any size mismatch on disk.
 */
export function saveAudioBuffer(
  buf: Buffer,
  opts: { baseDir?: string; ext?: string } = {},
): AudioSaveResult {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 502, error: "audio buffer is empty" };
  }
  let dir: string;
  try {
    dir = getAudioDir(opts.baseDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: `failed to create audio dir: ${msg}` };
  }
  const filename = makeSafeAudioName(opts.ext);
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
  return {
    ok: true,
    filePath,
    url: `/uploads/audio/${filename}`,
    sizeBytes: st.size,
  };
}
