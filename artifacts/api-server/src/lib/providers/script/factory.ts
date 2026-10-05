import { LocalGpuLlmProvider } from "./LocalGpuLlmProvider";
import { GroqScriptProvider } from "./GroqScriptProvider";
import type { ScriptProvider } from "./index";

/**
 * KAYAN-TASK-21 — Script provider selection.
 *
 * SCRIPT_PROVIDER=groq   → Groq (external, requires GROQ_API_KEY)
 * SCRIPT_PROVIDER=local  → LocalGpuLlmProvider (requires KAYAN_LLM_URL)
 *
 * If SCRIPT_PROVIDER is not set:
 *   - NODE_ENV=production → throw MISCONFIGURATION (no silent localhost fallback)
 *   - otherwise           → default to local (dev convenience)
 *
 * Legacy LLM_PROVIDER is still honored for backward compatibility.
 */
export function getScriptProvider(): ScriptProvider {
  const explicit = (process.env.SCRIPT_PROVIDER || "").trim().toLowerCase();
  const legacy = (process.env.LLM_PROVIDER || "").trim().toUpperCase();
  const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";

  // Explicit modern selector
  if (explicit === "groq") return new GroqScriptProvider();
  if (explicit === "local") return new LocalGpuLlmProvider();

  // Backward-compat with legacy LLM_PROVIDER values
  if (legacy === "GROQ" || legacy === "GROQ_LEGACY") {
    return new GroqScriptProvider();
  }
  if (legacy === "LOCAL_GPU" || legacy === "LOCAL") {
    return new LocalGpuLlmProvider();
  }

  // No explicit selector set
  if (isProd) {
    const err: any = new Error(
      "MISCONFIGURATION: SCRIPT_PROVIDER must be set in production " +
      "(allowed: 'groq' or 'local'). Silent fallback to localhost is disabled.",
    );
    err.code = "SCRIPT_PROVIDER_MISCONFIGURATION";
    throw err;
  }

  // Dev default
  return new LocalGpuLlmProvider();
}
