/**
 * KAYAN Sprint 1 - DNA Wiring
 * Builds the rich prompt for WaveSpeed by combining:
 * World Profile + Actor DNA + Shot Description + Camera Direction.
 * (Dialogue is excluded by design).
 */

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
  // Based on the translated framing
  if (!cameraMovement) return "primary_portrait";
  if (cameraMovement.includes("قريب")) return "primary_portrait";
  if (cameraMovement.includes("زاوية واسعة")) return "full_body";
  // Default to primary portrait for safe identity matching
  return "primary_portrait";
}

export function buildDnaPrompt(
  shot: any,
  actor: any | null,
  worldProfile: any | null
): string {
  const parts: string[] = [];

  // 1. World Context (Visual Style)
  if (worldProfile) {
    if (worldProfile.visual_style) parts.push(worldProfile.visual_style);
    if (worldProfile.lighting) parts.push(`Lighting: ${worldProfile.lighting}`);
    if (worldProfile.color_palette) parts.push(`Palette: ${worldProfile.color_palette}`);
    if (worldProfile.master_prompt) parts.push(worldProfile.master_prompt);
  }

  // 2. Actor DNA (Identity)
  if (actor) {
    if (actor.characterMasterPrompt) parts.push(actor.characterMasterPrompt);
    if (actor.physicalDescription) parts.push(actor.physicalDescription);
  }

  // 3. Shot Description (Action)
  if (shot.description) parts.push(shot.description);

  // 4. Camera Direction
  const cam = translateCamera(shot.camera_movement);
  if (cam) parts.push(`Camera: ${cam}`);

  return parts.filter(Boolean).join(". ");
}

export function buildNegativePrompt(actor: any | null, worldProfile: any | null): string {
  const defaults = "blurry, low quality, distorted, deformed, watermark, text";
  const parts: string[] = [defaults];
  if (worldProfile?.negative_prompt) parts.push(worldProfile.negative_prompt);
  if (actor?.characterNegativePrompt) parts.push(actor.characterNegativePrompt);
  return parts.join(", ");
}
