/**
 * KAYAN-7: role-aware environment validation.
 * Runs once at each entrypoint boot to fail fast when required env vars
 * are missing. Prevents silent failures that produce successful-looking
 * jobs with empty / mock outputs (documented incident: 90min debug).
 *
 * Design:
 *   - Never prints secret VALUES, only variable names.
 *   - Role-specific requirements:
 *       api               : DB, auth, storage, script (no video keys)
 *       queue-worker      : DB, script (no storage, no video)
 *       production-worker : DB, video (+voice)
 *   - Mock video provider is a WARNING (MOCK_VIDEO_PROVIDER), not error.
 *   - ALLOW_DEV_PRODUCTION_BYPASS=true downgrades errors to warnings ONLY
 *     when NODE_ENV != production. In production, errors always throw.
 */

export type ServiceRole = "api" | "queue-worker" | "production-worker";

export interface Providers {
  video: string;
  script: string;
  voice: string;
  storage: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  providers: Providers;
}

function has(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function isProd(): boolean {
  return (process.env.NODE_ENV || "production").toLowerCase() === "production";
}

function bypassAllowed(): boolean {
  return process.env.ALLOW_DEV_PRODUCTION_BYPASS === "true" && !isProd();
}


function checkProvider(role: ServiceRole, errs: string[], warns: string[]): Providers {
  const video = (process.env.VIDEO_PROVIDER || "kayangpu").toLowerCase();
  const videoKind = (process.env.VIDEO_EXTERNAL_KIND || "wavespeed").toLowerCase();
  const script = (process.env.SCRIPT_PROVIDER || "").toLowerCase();
  const voice = (process.env.VOICE_PROVIDER || "deepgram").toLowerCase();
  const storage = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  let videoName = video === "external" ? `external-${videoKind}` : video;

  if (role === "production-worker") {
    if (video === "external") {
      if (videoKind === "wavespeed") {
        if (!has(process.env.WAVESPEED_API_KEY)) errs.push("MISSING_WAVESPEED_API_KEY");
      } else if (videoKind === "mock") {
        warns.push("MOCK_VIDEO_PROVIDER");
      } else {
        errs.push(`INVALID_VIDEO_EXTERNAL_KIND:${videoKind}`);
      }
    } else if (video === "kayangpu") {
      if (!has(process.env.GPU_SSH_TARGET) && isProd()) {
        errs.push("MISSING_GPU_SSH_TARGET");
      }
    } else {
      errs.push(`INVALID_VIDEO_PROVIDER:${video}`);
    }
    if (voice === "deepgram" && !has(process.env.DEEPGRAM_API_KEY)) {
      warns.push("MISSING_DEEPGRAM_API_KEY");
    }
  }

  if (role === "api" || role === "queue-worker") {
    if (script === "groq" || script === "") {
      if (!has(process.env.GROQ_API_KEY)) errs.push("MISSING_GROQ_API_KEY");
      if (!has(process.env.GROQ_MODEL)) errs.push("MISSING_GROQ_MODEL");
    }
    if (script && script !== "groq" && script !== "local") {
      errs.push(`INVALID_SCRIPT_PROVIDER:${script}`);
    }
  }

  if (role === "api") {
    if (storage === "supabase") {
      if (!has(process.env.SUPABASE_URL)) errs.push("MISSING_SUPABASE_URL");
      if (!has(process.env.SUPABASE_BUCKET)) errs.push("MISSING_SUPABASE_BUCKET");
      if (!has(process.env.SUPABASE_SERVICE_ROLE_KEY)) errs.push("MISSING_SUPABASE_SERVICE_ROLE_KEY");
    } else if (storage === "r2") {
      if (!has(process.env.R2_ENDPOINT)) errs.push("MISSING_R2_ENDPOINT");
      if (!has(process.env.R2_ACCESS_KEY_ID)) errs.push("MISSING_R2_ACCESS_KEY_ID");
      if (!has(process.env.R2_SECRET_ACCESS_KEY)) errs.push("MISSING_R2_SECRET_ACCESS_KEY");
      if (!has(process.env.R2_BUCKET)) errs.push("MISSING_R2_BUCKET");
    } else if (storage !== "local") {
      errs.push(`INVALID_STORAGE_PROVIDER:${storage}`);
    }
    if (!has(process.env.PRODUCTION_API_TOKEN) && isProd()) {
      errs.push("MISSING_PRODUCTION_API_TOKEN");
    }
  }

  return { video: videoName, script: script || "local", voice, storage };
}


/**
 * Validate env for a given role. Pure (only reads process.env).
 * Never throws — caller decides policy (assert vs warn).
 */
export function validateEnv(role: ServiceRole): ValidationResult {
  const errs: string[] = [];
  const warns: string[] = [];

  if (!has(process.env.DATABASE_URL)) errs.push("MISSING_DATABASE_URL");

  const providers = checkProvider(role, errs, warns);

  // Non-blocking observations (for /api/healthz).
  if (providers.video === "external-mock") {
    if (!warns.includes("MOCK_VIDEO_PROVIDER")) warns.push("MOCK_VIDEO_PROVIDER");
  }

  return { ok: errs.length === 0, errors: errs, warnings: warns, providers };
}

/**
 * Boot helper. Throws on missing env (unless dev bypass + non-prod).
 * Logs a concise [env-check] line — variable NAMES only, never values.
 * Returns the ValidationResult so the caller can expose it (healthz).
 */
export function assertEnvOrThrow(role: ServiceRole): ValidationResult {
  const r = validateEnv(role);
  const tag = `[env-check role=${role}]`;

  if (r.warnings.length > 0) {
    console.warn(`${tag} WARN ${r.warnings.join(",")} (providers=${JSON.stringify(r.providers)})`);
  }

  if (r.errors.length > 0) {
    if (bypassAllowed()) {
      console.warn(`${tag} WARN (ALLOW_DEV_PRODUCTION_BYPASS=true, non-prod) missing=${r.errors.join(",")}`);
    } else {
      const msg = `${tag} FAIL missing=${r.errors.join(",")} — refusing to start`;
      console.error(msg);
      const err: any = new Error(msg);
      err.code = "ENV_VALIDATION_FAILED";
      err.missing = r.errors;
      throw err;
    }
  } else {
    console.log(`${tag} OK providers=${JSON.stringify(r.providers)}`);
  }

  return r;
}
