/**
 * KAYAN Sprint 1 P4.1 — DNA Prompt Builder
 * Combines World Profile + Actor DNA + Shot Description + Camera Direction.
 * - Fixes camelCase/snake_case mismatch from Drizzle.
 * - Translates Arabic fields to English (World/Actor/Shot) before sending to WaveSpeed.
 * - Dialogue is excluded by design (goes to Voice pipeline).
 */
import { translateToEnglish, containsArabic } from "./translateHelper";

export function translateCamera(arabicCam: string | null): string {
  if (!arabicCam) return "";
  const mapping: Record<string, string> = {
    "ثابت": "Static shot, no movement",
    "تحريك بطيء": "Slow camera pan",
    "تحريك سريع": "Fast camera pan",
    "Handheld (محمول باليد)": "Handheld camera, slight shake",
    "قريب": "Close-up framing",
    "زاوية واسعة": "Wide shot framing",
  };
  return mapping[arabicCam] || arabicCam;
}

export function pickReferenceType(cameraMovement: string | null): string {
  if (!cameraMovement) return "primary_portrait";
  if (cameraMovement.includes("قريب")) return "primary_portrait";
  if (cameraMovement.includes("زاوية واسعة")) return "full_body";
  return "primary_portrait";
}

/** Read a field by either camelCase (Drizzle) or snake_case (raw SQL). */
function get(obj: any, camel: string, snake: string): string | null {
  if (!obj) return null;
  const v = obj[camel] ?? obj[snake];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface DnaPromptResult {
  prompt: string;
  negativePrompt: string;
  warnings: string[];
  translation: {
    performed: boolean;
    failedFields: string[];
  };
}

export async function buildDnaPromptAsync(
  shot: any,
  actor: any | null,
  worldProfile: any | null,
): Promise<DnaPromptResult> {
  const parts: string[] = [];
  const warnings: string[] = [];
  const failedFields: string[] = [];
  let performed = false;

  const t = async (text: string | null, field: string): Promise<string | null> => {
    if (!text) return null;
    const res = await translateToEnglish(text, field);
    if (res.warning) { warnings.push(res.warning); failedFields.push(field); }
    if (res.translated) performed = true;
    return res.text;
  };

  // 1. World Context (camelCase first, snake_case fallback)
  if (worldProfile) {
    const vs = get(worldProfile, "visualStyle", "visual_style");
    if (vs) { const x = await t(vs, "world.visualStyle"); if (x) parts.push(x); }
    const lt = get(worldProfile, "lighting", "lighting");
    if (lt) { const x = await t(lt, "world.lighting"); if (x) parts.push(`Lighting: ${x}`); }
    const cp = get(worldProfile, "colorPalette", "color_palette");
    if (cp) { const x = await t(cp, "world.colorPalette"); if (x) parts.push(`Palette: ${x}`); }
    const mp = get(worldProfile, "masterPrompt", "master_prompt");
    if (mp) { const x = await t(mp, "world.masterPrompt"); if (x) parts.push(x); }
  }

  // 2. Actor DNA (master = usually EN, physical = usually AR)
  if (actor) {
    if (actor.characterMasterPrompt) {
      const x = await t(actor.characterMasterPrompt, "actor.masterPrompt");
      if (x) parts.push(x);
    }
    if (actor.physicalDescription) {
      const x = await t(actor.physicalDescription, "actor.physicalDescription");
      if (x) parts.push(x);
    }
  }

  // 3. Shot Description (usually AR)
  if (shot.description) {
    const x = await t(shot.description, "shot.description");
    if (x) parts.push(x);
  }

  // 4. Camera Direction (already EN via mapping)
  const cam = translateCamera(shot.camera_movement || null);
  if (cam) parts.push(`Camera: ${cam}`);

  // 5. Negative Prompt (combine World + Actor, translate if Arabic)
  const negParts: string[] = ["blurry, low quality, distorted, deformed, watermark, text"];
  if (worldProfile) {
    const wn = get(worldProfile, "negativePrompt", "negative_prompt");
    if (wn) { const x = await t(wn, "world.negativePrompt"); if (x) negParts.push(x); }
  }
  if (actor?.characterNegativePrompt) {
    const x = await t(actor.characterNegativePrompt, "actor.negativePrompt");
    if (x) negParts.push(x);
  }

  return {
    prompt: parts.filter(Boolean).join(". "),
    negativePrompt: negParts.filter(Boolean).join(", "),
    warnings,
    translation: { performed, failedFields },
  };
}

/** Sync fallback (no translation) — kept for backward compat. */
export function buildDnaPrompt(
  shot: any,
  actor: any | null,
  worldProfile: any | null,
): string {
  const parts: string[] = [];
  if (worldProfile) {
    const vs = get(worldProfile, "visualStyle", "visual_style");
    if (vs) parts.push(vs);
    const lt = get(worldProfile, "lighting", "lighting");
    if (lt) parts.push(`Lighting: ${lt}`);
    const cp = get(worldProfile, "colorPalette", "color_palette");
    if (cp) parts.push(`Palette: ${cp}`);
    const mp = get(worldProfile, "masterPrompt", "master_prompt");
    if (mp) parts.push(mp);
  }
  if (actor?.characterMasterPrompt) parts.push(actor.characterMasterPrompt);
  if (actor?.physicalDescription) parts.push(actor.physicalDescription);
  if (shot.description) parts.push(shot.description);
  const cam = translateCamera(shot.camera_movement || null);
  if (cam) parts.push(`Camera: ${cam}`);
  return parts.filter(Boolean).join(". ");
}

export function buildNegativePrompt(actor: any | null, worldProfile: any | null): string {
  const parts: string[] = ["blurry, low quality, distorted, deformed, watermark, text"];
  const wn = worldProfile ? get(worldProfile, "negativePrompt", "negative_prompt") : null;
  if (wn) parts.push(wn);
  if (actor?.characterNegativePrompt) parts.push(actor.characterNegativePrompt);
  return parts.join(", ");
}
