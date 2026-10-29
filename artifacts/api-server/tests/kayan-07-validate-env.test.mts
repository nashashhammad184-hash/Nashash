/**
 * KAYAN-7: unit tests for role-aware env validation.
 * Pure — no DB, no HTTP, no files. Only manipulates process.env.
 */
import { validateEnv, assertEnvOrThrow } from "../src/lib/validateEnv";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const KEYS = ["DATABASE_URL","PRODUCTION_API_TOKEN","STORAGE_PROVIDER","SUPABASE_URL","SUPABASE_BUCKET","SUPABASE_SERVICE_ROLE_KEY","SCRIPT_PROVIDER","GROQ_API_KEY","GROQ_MODEL","VIDEO_PROVIDER","VIDEO_EXTERNAL_KIND","WAVESPEED_API_KEY","DEEPGRAM_API_KEY","VOICE_PROVIDER","GPU_SSH_TARGET","NODE_ENV","ALLOW_DEV_PRODUCTION_BYPASS","SERVICE_ROLE"];
function clearAll() { for (const k of KEYS) delete (process.env as any)[k]; }

// E1: api missing SUPABASE_URL
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.PRODUCTION_API_TOKEN = "t";
process.env.STORAGE_PROVIDER = "supabase";
process.env.SUPABASE_BUCKET = "b";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.SCRIPT_PROVIDER = "local";
{
  const r = validateEnv("api");
  report("E1 api missing SUPABASE_URL", !r.ok && r.errors.includes("MISSING_SUPABASE_URL"));
}

// E2: queue-worker missing GROQ_API_KEY
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.SCRIPT_PROVIDER = "groq";
process.env.GROQ_MODEL = "openai/gpt-oss-120b";
{
  const r = validateEnv("queue-worker");
  report("E2 qw missing GROQ_API_KEY", !r.ok && r.errors.includes("MISSING_GROQ_API_KEY"));
}

// E3: production-worker with mock → warning not error
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "mock";
process.env.VOICE_PROVIDER = "deepgram";
process.env.DEEPGRAM_API_KEY = "d";
{
  const r = validateEnv("production-worker");
  report("E3 pw mock → warn", r.ok && r.warnings.includes("MOCK_VIDEO_PROVIDER"));
}

// E4: api with SCRIPT_PROVIDER=local → no GROQ requirement
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.PRODUCTION_API_TOKEN = "t";
process.env.STORAGE_PROVIDER = "local";
process.env.SCRIPT_PROVIDER = "local";
{
  const r = validateEnv("api");
  report("E4 api local no GROQ", r.ok && !r.errors.some((e) => e.startsWith("MISSING_GROQ")));
}

// E5: api missing DATABASE_URL
clearAll();
process.env.NODE_ENV = "production";
process.env.STORAGE_PROVIDER = "local";
process.env.SCRIPT_PROVIDER = "local";
process.env.PRODUCTION_API_TOKEN = "t";
{
  const r = validateEnv("api");
  report("E5 api missing DATABASE_URL", !r.ok && r.errors.includes("MISSING_DATABASE_URL"));
}

// E6: production-worker with wavespeed missing key
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "wavespeed";
process.env.VOICE_PROVIDER = "deepgram";
process.env.DEEPGRAM_API_KEY = "d";
{
  const r = validateEnv("production-worker");
  report("E6 pw wavespeed missing key", !r.ok && r.errors.includes("MISSING_WAVESPEED_API_KEY"));
}

// E7: invalid VIDEO_EXTERNAL_KIND
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.VIDEO_PROVIDER = "external";
process.env.VIDEO_EXTERNAL_KIND = "bogus";
process.env.DEEPGRAM_API_KEY = "d";
{
  const r = validateEnv("production-worker");
  report("E7 invalid VIDEO_EXTERNAL_KIND", !r.ok && r.errors.some((e) => e.startsWith("INVALID_VIDEO_EXTERNAL_KIND:")));
}

// E8: assertEnvOrThrow throws with clear code
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.SCRIPT_PROVIDER = "groq";
process.env.GROQ_MODEL = "openai/gpt-oss-120b";
{
  let threw = false, code = "";
  try { assertEnvOrThrow("queue-worker"); } catch (e: any) { threw = true; code = e.code; }
  report("E8 assert throws", threw && code === "ENV_VALIDATION_FAILED");
}

// E9: healthy env → providers exposed
clearAll();
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://x";
process.env.PRODUCTION_API_TOKEN = "t";
process.env.STORAGE_PROVIDER = "supabase";
process.env.SUPABASE_URL = "https://x";
process.env.SUPABASE_BUCKET = "b";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.SCRIPT_PROVIDER = "groq";
process.env.GROQ_API_KEY = "g";
process.env.GROQ_MODEL = "openai/gpt-oss-120b";
{
  const r = validateEnv("api");
  report("E9 healthy api", r.ok && r.providers.script === "groq" && r.providers.storage === "supabase");
}

// E10: bypass only when non-prod + flag
clearAll();
process.env.NODE_ENV = "production";
process.env.ALLOW_DEV_PRODUCTION_BYPASS = "true";
process.env.DATABASE_URL = "postgres://x";
process.env.SCRIPT_PROVIDER = "groq";
process.env.GROQ_MODEL = "openai/gpt-oss-120b";
{
  let threw = false;
  try { assertEnvOrThrow("queue-worker"); } catch { threw = true; }
  report("E10 bypass ignored in production", threw);
}

// E11: dev + bypass → no throw
clearAll();
process.env.NODE_ENV = "development";
process.env.ALLOW_DEV_PRODUCTION_BYPASS = "true";
process.env.DATABASE_URL = "postgres://x";
process.env.SCRIPT_PROVIDER = "groq";
process.env.GROQ_MODEL = "openai/gpt-oss-120b";
{
  let threw = false;
  try { assertEnvOrThrow("queue-worker"); } catch { threw = true; }
  report("E11 dev bypass allows start", !threw);
}

clearAll();
console.log(`
=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
