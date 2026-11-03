import crypto from "crypto";
import { GroqDirectorResponseSchema, AudioInstructionSchema, AUDAR_TAGS, EMOTIONS } from "./directorSchema";
import { buildDirectorPrompt } from "./directorPrompt";
import { extractLeadingTag } from "./resolveInstruction";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

function hashInput(description: string, dialogue: string, characterId: number | null): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify({ description, dialogue, characterId }));
  return h.digest("hex");
}

export interface DirectorResult {
  ok: boolean;
  audio_instruction?: any;
  error?: string;
}

export async function runDirector(
  description: string,
  dialogue: string,
  characterId: number | null,
  characterInfo?: string
): Promise<DirectorResult> {
  const manualTag = extractLeadingTag(dialogue);
  const inputHash = hashInput(description, dialogue, characterId);

  if (manualTag) {
    const instruction = AudioInstructionSchema.parse({
      version: "v1",
      model: "manual-dialogue",
      analyzed_at: new Date().toISOString(),
      input_hash: inputHash,
      fields: {
        emotion: { value: "neutral", source: "dialogue", confidence: 1.0 },
        delivery: { value: "manual", source: "dialogue", confidence: 1.0 },
        intensity: { value: 0.5, source: "dialogue", confidence: 1.0 },
        audar_tag: { value: manualTag, source: "dialogue", confidence: 1.0 }
      },
      reasoning: "User-provided tag in dialogue"
    });
    return { ok: true, audio_instruction: instruction };
  }

  if (!description || description.trim().length < 10) {
    return { ok: false, error: "DESCRIPTION_TOO_SHORT" };
  }

  const prompt = buildDirectorPrompt(description, dialogue, characterInfo);
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
      const parsed = GroqDirectorResponseSchema.safeParse(JSON.parse(content));
      if (!parsed.success) { lastErr = "GROQ_INVALID_JSON"; continue; }

      const instruction = AudioInstructionSchema.parse({
        version: "v1",
        model: GROQ_MODEL,
        analyzed_at: new Date().toISOString(),
        input_hash: inputHash,
        fields: {
          emotion: { value: parsed.data.emotion, source: "director", confidence: parsed.data.confidence },
          delivery: { value: parsed.data.delivery, source: "director", confidence: parsed.data.confidence },
          intensity: { value: parsed.data.intensity, source: "director", confidence: parsed.data.confidence },
          audar_tag: { value: parsed.data.audar_tag, source: "director", confidence: parsed.data.confidence }
        },
        reasoning: parsed.data.reasoning
      });
      return { ok: true, audio_instruction: instruction };
    } catch (e: any) {
      lastErr = e?.message || "GROQ_UNKNOWN";
    }
  }
  return { ok: false, error: lastErr };
}
