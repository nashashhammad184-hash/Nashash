import { LocalGpuLlmProvider } from "./LocalGpuLlmProvider";
import type { ScriptProvider } from "./index";

export function getScriptProvider(): ScriptProvider {
  const which = (process.env.LLM_PROVIDER || "LOCAL_GPU").toUpperCase();
  if (which === "GROQ_LEGACY") {
    // TODO: instantiate legacy GroqProvider when we wrap it
    throw new Error("GROQ_LEGACY not wired yet");
  }
  return new LocalGpuLlmProvider();
}
