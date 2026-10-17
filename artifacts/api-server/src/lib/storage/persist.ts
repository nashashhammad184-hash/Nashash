/**
 * KAYAN-TASK-73D: small helpers for persisting generated media through the
 * active storage provider.
 * KAYAN-TASK-73J: streaming upload for large files; subtitle text helper.
 *
 * Under STORAGE_PROVIDER=local the write goes to uploads/<subdir>/<filename>
 * (behavior-identical to prior direct fs writes). Under remote providers the
 * file is uploaded and publicUrl() returns the remote URL.
 */
import fs from "node:fs";
import path from "node:path";
import { getStorage } from "./index";

export interface PersistedMedia {
  readonly key: string;
  readonly url: string;
  readonly sizeBytes: number;
  readonly basename: string;
}

type Subdir = "videos" | "audio" | "renders" | "canonical_faces" | "subtitles";

async function persistFile(
  localPath: string,
  subdir: Subdir,
  contentType: string,
): Promise<PersistedMedia> {
  if (!localPath || typeof localPath !== "string") {
    throw new Error("persistFile: localPath is required");
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`persistFile: file not found: ${localPath}`);
  }
  const st = fs.statSync(localPath);
  if (!st.isFile() || st.size === 0) {
    throw new Error(`persistFile: file is empty: ${localPath}`);
  }
  const basename = path.basename(localPath);
  const key = `${subdir}/${basename}`;
  const provider = getStorage();

  // Under local provider, if the file already lives at the target path,
  // no write is needed.
  if (provider.name === "local") {
    const targetAbs = path.resolve(process.cwd(), "uploads", key);
    if (path.resolve(localPath) === targetAbs) {
      return { key, url: provider.publicUrl(key), sizeBytes: st.size, basename };
    }
    // Otherwise: local copy to uploads/<subdir>/<basename>.
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.copyFileSync(localPath, targetAbs);
    return { key, url: provider.publicUrl(key), sizeBytes: st.size, basename };
  }

  // Remote provider. Prefer streaming when supported (TASK-73J).
  if (typeof provider.writeFromFile === "function") {
    await provider.writeFromFile(localPath, key, contentType);
    // Verify via HEAD/metadata when possible.
    const remoteSize = await provider.getSize?.(key);
    if (typeof remoteSize === "number" && remoteSize !== st.size) {
      throw new Error(
        `persistFile: remote size mismatch for ${key} (local=${st.size}, remote=${remoteSize})`,
      );
    }
    return { key, url: provider.publicUrl(key), sizeBytes: st.size, basename };
  }

  // Fallback: full read into Buffer (small files only).
  const buf = fs.readFileSync(localPath);
  const url = await provider.write(key, buf, contentType);
  return { key, url, sizeBytes: st.size, basename };
}

export async function persistVideoFile(localPath: string): Promise<PersistedMedia> {
  return persistFile(localPath, "videos", "video/mp4");
}

export async function persistAudioFile(localPath: string): Promise<PersistedMedia> {
  return persistFile(localPath, "audio", "audio/mpeg");
}

export async function persistRenderFile(localPath: string): Promise<PersistedMedia> {
  return persistFile(localPath, "renders", "video/mp4");
}

/**
 * KAYAN-TASK-73J: persist subtitle text (SRT/VTT) via storage layer.
 * Writes UTF-8 text; returns the storage URL.
 */
export async function persistSubtitleText(
  text: string,
  filename: string,
  contentType: "application/x-subrip; charset=utf-8" | "text/vtt; charset=utf-8" = "application/x-subrip; charset=utf-8",
): Promise<PersistedMedia> {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("persistSubtitleText: text is required");
  }
  if (!filename || !/\.(srt|vtt)$/i.test(filename)) {
    throw new Error(`persistSubtitleText: filename must end with .srt or .vtt: ${filename}`);
  }
  const basename = path.basename(filename);
  const key = `subtitles/${basename}`;
  const buf = Buffer.from(text, "utf-8");
  if (buf.length === 0) {
    throw new Error("persistSubtitleText: encoded buffer is empty");
  }
  const provider = getStorage();
  const url = await provider.write(key, buf, contentType);
  return { key, url, sizeBytes: buf.length, basename };
}
