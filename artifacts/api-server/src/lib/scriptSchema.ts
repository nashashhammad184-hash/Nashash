/**
 * KAYAN-TASK-15 — Script Generator Output Contract.
 *
 * The LLM (vLLM + Qwen2.5-7B-AWQ) returns a JSON document that MUST be
 * structurally valid before it can be persisted to the DB and consumed by
 * shot creation. This schema is the single source of truth for that contract.
 *
 * Downstream consumers (ScriptJobRunner → shotsTable) need:
 *   - title
 *   - scenes[].sceneNumber, sceneTitle, visualDescription, characterDialogue,
 *     shots[].{shotOrder, description, cameraMovement, durationSeconds}
 *     (dialogue / audioNote optional in effect)
 *
 * Anything else is rejected so invalid scripts never reach the DB.
 */
import { z } from "zod";

export const GeneratedShotSchema = z.object({
  shotOrder: z.number().int().min(1),
  description: z.string().min(1, "shot.description must be non-empty"),
  cameraMovement: z.string().min(1, "shot.cameraMovement must be non-empty"),
  durationSeconds: z.number().positive().max(60),
  dialogue: z.string().default(""),
  audioNote: z.string().default(""),
});

export const GeneratedSceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  sceneTitle: z.string().min(1),
  visualDescription: z.string().min(1),
  characterDialogue: z.string().default(""),
  backingScorePrompt: z.string().default(""),
  audioMusic: z.string().default(""),
  englishSubtitles: z.string().default(""),
  shots: z.array(GeneratedShotSchema).min(1, "scene must contain at least one shot"),
});

export const GeneratedScriptSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(GeneratedSceneSchema).min(1, "script must contain at least one scene").max(8),
});

export type GeneratedShot = z.infer<typeof GeneratedShotSchema>;
export type GeneratedScene = z.infer<typeof GeneratedSceneSchema>;
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;

export interface ParseResult {
  ok: boolean;
  data?: GeneratedScript;
  error?: string;
  raw?: string;
}

/**
 * Strip common LLM wrapping: ```json fenced blocks, leading/trailing prose.
 * Returns the JSON substring, or the original string if no fence detected.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // If there is still leading prose before the first '{', slice from there.
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return s;
}

/**
 * Parse + validate. Throws on failure with a clear, terse message.
 * Returns the validated object on success.
 */
export function parseAndValidateScript(raw: string): GeneratedScript {
  if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("SCRIPT_PARSE_FAILED: empty response from LLM");
  }
  const jsonText = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    const preview = jsonText.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`SCRIPT_PARSE_FAILED: malformed JSON (${e?.message}). Preview: ${preview}`);
  }
  const v = GeneratedScriptSchema.safeParse(parsed);
  if (!v.success) {
    const issues = v.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`SCRIPT_VALIDATION_FAILED: ${issues}`);
  }
  return v.data;
}
