/**
 * GroqScriptProvider — external LLM for script generation.
 *
 * Selected when SCRIPT_PROVIDER=groq.
 * Uses GROQ_API_KEY from environment. No hardcoded keys.
 *
 * If SCRIPT_PROVIDER=groq but GROQ_API_KEY is missing, the constructor
 * throws MISCONFIGURATION — no silent fallback to localhost.
 */
import Groq from "groq-sdk";
import type { ScriptProvider, ScriptRequest, ScriptResponse } from "./index";

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export class GroqScriptProvider implements ScriptProvider {
  name = "GROQ";
  private client: Groq;
  private model: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      const err: any = new Error(
        "MISCONFIGURATION: SCRIPT_PROVIDER=groq requires GROQ_API_KEY (not set)",
      );
      err.code = "SCRIPT_PROVIDER_MISCONFIGURATION";
      throw err;
    }
    this.client = new Groq({ apiKey });
    this.model = DEFAULT_MODEL;
  }

  async generate(req: ScriptRequest): Promise<ScriptResponse> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.language === "ar") {
      messages.push({
        role: "system",
        content:
          "You are a professional Arabic film script writer. " +
          "Always return strictly valid JSON when the user requests JSON. " +
          "Do not wrap JSON in markdown code fences.",
      });
    } else {
      messages.push({
        role: "system",
        content:
          "You are a professional film script writer. " +
          "Always return strictly valid JSON when the user requests JSON. " +
          "Do not wrap JSON in markdown code fences.",
      });
    }
    messages.push({ role: "user", content: req.prompt });

    const body: any = {
      model: this.model,
      messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.schemaJson) {
      body.response_format = { type: "json_object" };
    }

    const completion = await this.client.chat.completions.create(body);
    const content = completion?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("Groq returned empty content");
    }
    return {
      content,
      provider: this.name,
      model: this.model,
    };
  }
}
