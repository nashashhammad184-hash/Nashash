/**
 * KAYAN Sprint 1 P4.1 — Translation Helper
 * Translates Arabic text to English for WaveSpeed (Hunyuan 1.5 trains on English).
 * - Detects Arabic via Unicode range.
 * - Caches results in-memory (1h TTL) to avoid repeated Groq calls.
 * - On Groq failure: returns original text + logs warning (graceful degradation).
 * - Never modifies DB (only translates at prompt-build time).
 */
import Groq from "groq-sdk";

const _cache = new Map<string, { value: string; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _client: Groq | null = null;
function getClient(): Groq {
  if (_client) return _client;
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY missing");
  _client = new Groq({ apiKey: key });
  return _client;
}

export function containsArabic(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  return /[\u0600-\u06FF]/.test(text);
}

export interface TranslateResult {
  text: string;
  translated: boolean;
  fromCache: boolean;
  warning?: string;
}

export async function translateToEnglish(
  text: string | null | undefined,
  fieldName: string,
): Promise<TranslateResult> {
  if (!text || typeof text !== "string") {
    return { text: "", translated: false, fromCache: false };
  }
  if (!containsArabic(text)) {
    return { text, translated: false, fromCache: false };
  }

  const cacheKey = `${fieldName}:${text}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { text: cached.value, translated: true, fromCache: true };
  }

  try {
    const client = getClient();
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a professional Arabic-to-English translator for cinema production. " +
            "Translate the user's Arabic text to natural, precise English suitable for an AI video generation prompt. " +
            "Preserve all visual details (colors, angles, emotions, movement). " +
            "Do NOT add explanations. Do NOT add quotes. Return ONLY the English translation.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "text" },
    });
    const out = (completion.choices?.[0]?.message?.content || "").trim();
    if (!out) throw new Error("empty translation");
    _cache.set(cacheKey, { value: out, ts: Date.now() });
    return { text: out, translated: true, fromCache: false };
  } catch (err: any) {
    console.warn(`[translate] ${fieldName} failed: ${err?.message || err}`);
    return {
      text,
      translated: false,
      fromCache: false,
      warning: `TRANSLATION_FAILED (${fieldName}): Groq unavailable — Arabic preserved`,
    };
  }
}

export function clearTranslationCache(): void {
  _cache.clear();
}
