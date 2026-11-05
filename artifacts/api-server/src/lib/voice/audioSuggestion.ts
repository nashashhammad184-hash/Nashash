import { buildAudioSuggestionPrompt } from "./audioSuggestionPrompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

export interface SuggestedAsset {
  asset_id: string;
  asset_type: string;
  start_time: number;
  end_time: number;
  volume: number;
  fade_in: number;
  fade_out: number;
  reasoning: string;
}

export interface SuggestionResult {
  ok: boolean;
  suggestions?: SuggestedAsset[];
  error?: string;
}

export async function suggestAudio(
  description: string,
  dialogue: string,
  availableAssets: Array<{ asset_id: string; name: string; asset_type: string; tags: string[] }>
): Promise<SuggestionResult> {
  if (!description || description.trim().length < 10) {
    return { ok: false, error: "DESCRIPTION_TOO_SHORT" };
  }
  if (!availableAssets || availableAssets.length === 0) {
    return { ok: false, error: "EMPTY_LIBRARY" };
  }

  const prompt = buildAudioSuggestionPrompt(description, dialogue, availableAssets);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, error: "GROQ_API_KEY_MISSING" };

  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { lastErr = `GROQ_HTTP_${res.status}`; continue; }
      const data = await res.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) { lastErr = "GROQ_EMPTY"; continue; }
      const parsed = JSON.parse(content);
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      // Validate: only allow asset_ids from library
      const allowedIds = new Set(availableAssets.map(a => a.asset_id));
      const valid = suggestions.filter((s: any) => allowedIds.has(s.asset_id));
      return { ok: true, suggestions: valid };
    } catch (e: any) {
      lastErr = e?.message || "GROQ_UNKNOWN";
    }
  }
  return { ok: false, error: lastErr };
}
