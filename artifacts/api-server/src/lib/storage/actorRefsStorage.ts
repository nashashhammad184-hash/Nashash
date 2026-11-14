import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const DEFAULT_BUCKET = "actor-refs";
const DEFAULT_SIGNED_URL_TTL = 3600;
const MAX_STORAGE_KEY_LENGTH = 200;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_STORED_BYTES = 5 * 1024 * 1024;
export const MAX_OUTPUT_DIMENSION = 2048;
export const MAX_INPUT_PIXELS = 50 * 1000 * 1000;

interface Config {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

function readConfig(): Config {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = (process.env.SUPABASE_ACTOR_REFS_BUCKET || DEFAULT_BUCKET).trim();
  if (!url || !key) {
    throw new Error("actorRefsStorage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return { url, serviceRoleKey: key, bucket };
}

let _client: SupabaseClient | null = null;
let _cfg: Config | null = null;

function getClient(): { client: SupabaseClient; cfg: Config } {
  if (_client && _cfg) return { client: _client, cfg: _cfg };
  const cfg = readConfig();
  _client = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  _cfg = cfg;
  return { client: _client, cfg };
}

export function isValidStorageKey(key: string): boolean {
  if (!key || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) return false;
  if (key.startsWith("/") || key.endsWith("/")) return false;
  if (key.includes("..") || key.includes("\\")) return false;
  return /^[a-zA-Z0-9._\-\/]+$/.test(key);
}

export function isStoragePath(assetUrl: string | null | undefined): boolean {
  if (!assetUrl || typeof assetUrl !== "string") return false;
  if (assetUrl.startsWith("http://") || assetUrl.startsWith("https://")) return false;
  if (assetUrl.startsWith("/")) return false;
  return isValidStorageKey(assetUrl);
}

export function generateStorageKey(actorId: number, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webp";
  const uuid = randomUUID();
  return `actors/${actorId}/${uuid}.${safeExt}`;
}

export async function uploadReference(
  storageKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  if (!isValidStorageKey(storageKey)) throw new Error("INVALID_STORAGE_KEY");
  const { client, cfg } = getClient();
  const { error } = await client.storage.from(cfg.bucket).upload(storageKey, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`UPLOAD_FAILED: ${error.message}`);
}

export async function deleteReference(storageKey: string): Promise<void> {
  if (!isValidStorageKey(storageKey)) throw new Error("INVALID_STORAGE_KEY");
  const { client, cfg } = getClient();
  const { error } = await client.storage.from(cfg.bucket).remove([storageKey]);
  if (error) throw new Error(`DELETE_FAILED: ${error.message}`);
}

export async function createSignedUrlsForKeys(
  storageKeys: string[],
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const validKeys = storageKeys.filter(isValidStorageKey);
  for (const k of storageKeys) result[k] = null;
  if (validKeys.length === 0) return result;
  try {
    const { client, cfg } = getClient();
    const { data, error } = await client.storage.from(cfg.bucket).createSignedUrls(validKeys, ttlSeconds);
    if (error || !data) return result;
    for (const item of data as any[]) {
      const k = item?.path;
      const url = item?.signedUrl || null;
      if (typeof k === "string" && k in result) result[k] = url;
    }
  } catch {
    // leave nulls on unexpected failure
  }
  return result;
}

class Semaphore {
  private readonly max: number;
  private available: number;
  private waiters: (() => void)[] = [];
  constructor(max: number) {
    this.max = Math.max(1, max);
    this.available = this.max;
  }
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available = Math.min(this.available + 1, this.max);
  }
}

export const imageProcessingSemaphore = new Semaphore(2);
