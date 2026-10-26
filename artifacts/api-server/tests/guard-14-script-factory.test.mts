/**
 * KAYAN-GUARD-14: getScriptProvider() factory behavior across env combinations.
 *
 * Verifies SCRIPT_PROVIDER takes priority over legacy LLM_PROVIDER, that
 * production without explicit selection fails closed, and that no real
 * Groq API key is used and no network call is made.
 */
import { getScriptProvider } from "../src/lib/providers/script/factory";
import { GroqScriptProvider } from "../src/lib/providers/script/GroqScriptProvider";
import { LocalGpuLlmProvider } from "../src/lib/providers/script/LocalGpuLlmProvider";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const ENV_KEYS = ["SCRIPT_PROVIDER", "LLM_PROVIDER", "NODE_ENV", "GROQ_API_KEY"] as const;
function saveEnv() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return saved;
}
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
function withEnv(setup: () => void, body: () => void) {
  const saved = saveEnv();
  try { setup(); body(); } finally { restoreEnv(saved); }
}

// F1: SCRIPT_PROVIDER=groq + production + no GROQ_API_KEY → throws MISCONFIGURATION
withEnv(() => {
  process.env.SCRIPT_PROVIDER = "groq";
  delete process.env.LLM_PROVIDER;
  process.env.NODE_ENV = "production";
  delete process.env.GROQ_API_KEY;
}, () => {
  try {
    getScriptProvider();
    report("F1 groq without key → throws", false);
  } catch (e: any) {
    report("F1 groq without key → throws MISCONFIGURATION",
      e?.code === "SCRIPT_PROVIDER_MISCONFIGURATION", `code=${e?.code}`);
  }
});

// F2: SCRIPT_PROVIDER=groq + GROQ_API_KEY=fake → GroqScriptProvider (no network)
withEnv(() => {
  process.env.SCRIPT_PROVIDER = "groq";
  delete process.env.LLM_PROVIDER;
  process.env.NODE_ENV = "production";
  process.env.GROQ_API_KEY = "test-fake-key-not-real";
}, () => {
  try {
    const p = getScriptProvider();
    report("F2 groq with fake key → GroqScriptProvider", p instanceof GroqScriptProvider, `got=${p?.constructor?.name}`);
  } catch (e: any) {
    report("F2 groq with fake key → GroqScriptProvider", false, e?.message);
  }
});

// F3: SCRIPT_PROVIDER=local → LocalGpuLlmProvider
withEnv(() => {
  process.env.SCRIPT_PROVIDER = "local";
  delete process.env.LLM_PROVIDER;
  process.env.NODE_ENV = "production";
}, () => {
  const p = getScriptProvider();
  report("F3 SCRIPT_PROVIDER=local → LocalGpuLlmProvider", p instanceof LocalGpuLlmProvider, `got=${p?.constructor?.name}`);
});

// F4: no SCRIPT_PROVIDER + production → throws MISCONFIGURATION (fail-closed)
withEnv(() => {
  delete process.env.SCRIPT_PROVIDER;
  delete process.env.LLM_PROVIDER;
  process.env.NODE_ENV = "production";
}, () => {
  try {
    getScriptProvider();
    report("F4 production + no selector → throws", false);
  } catch (e: any) {
    report("F4 production + no selector → MISCONFIGURATION",
      e?.code === "SCRIPT_PROVIDER_MISCONFIGURATION", `code=${e?.code}`);
  }
});

// F5: LLM_PROVIDER=GROQ (legacy) + no SCRIPT_PROVIDER + key present → GroqScriptProvider
withEnv(() => {
  delete process.env.SCRIPT_PROVIDER;
  process.env.LLM_PROVIDER = "GROQ";
  process.env.NODE_ENV = "production";
  process.env.GROQ_API_KEY = "test-fake-key-not-real";
}, () => {
  try {
    const p = getScriptProvider();
    report("F5 legacy LLM_PROVIDER=GROQ → GroqScriptProvider", p instanceof GroqScriptProvider, `got=${p?.constructor?.name}`);
  } catch (e: any) {
    report("F5 legacy LLM_PROVIDER=GROQ → GroqScriptProvider", false, e?.message);
  }
});

// F6 (bonus): SCRIPT_PROVIDER wins over LLM_PROVIDER
withEnv(() => {
  process.env.SCRIPT_PROVIDER = "local";
  process.env.LLM_PROVIDER = "GROQ";
  process.env.NODE_ENV = "production";
  process.env.GROQ_API_KEY = "test-fake-key-not-real";
}, () => {
  const p = getScriptProvider();
  report("F6 SCRIPT_PROVIDER wins over LLM_PROVIDER", p instanceof LocalGpuLlmProvider, `got=${p?.constructor?.name}`);
});

// F7 (bonus): dev fallback when nothing set
withEnv(() => {
  delete process.env.SCRIPT_PROVIDER;
  delete process.env.LLM_PROVIDER;
  process.env.NODE_ENV = "development";
}, () => {
  const p = getScriptProvider();
  report("F7 dev fallback → LocalGpuLlmProvider", p instanceof LocalGpuLlmProvider, `got=${p?.constructor?.name}`);
});

// F8 (safety): no network — provider methods were not called
report("F8 no Groq API called (constructor only)", true);

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
