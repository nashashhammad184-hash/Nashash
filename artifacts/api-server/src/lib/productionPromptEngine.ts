export interface ShotPromptInput {
  world: {
    visualStyle?: string;
    lighting?: string;
    colorPalette?: string;
    atmosphere?: string;
    masterPrompt?: string;
  };
  scene: {
    location?: string;
    timeOfDay?: string;
    weather?: string;
    description?: string;
  };
  shot: {
    camera?: string;
    action?: string;
    dialogue?: string;
  };
  characters: Array<{
    name: string;
    characterPrompt?: string;
    wardrobeColor?: string;
    microExpression?: string;
  }>;
}

export function buildCentralizedShotPrompt(input: ShotPromptInput): string {
  const { world, scene, shot, characters } = input;

  // 1. Core Visual Directives & Camera
  const cameraSegment = shot.camera ? `[Camera Path: ${shot.camera}]` : "[Cinematic Shot]";
  const worldStyle = world.visualStyle || "Highly detailed cinematic film still, Netflix production value";
  
  // 2. Environment Fusing
  const environmentSegment = `Environment: Located in ${scene.location || "Scenic area"}, ${scene.timeOfDay || "Daytime"}. Weather: ${scene.weather || "Clear Skies"}. Atmosphere: ${world.atmosphere || "Dramatic"}.`;
  const lightingPalette = `Lighting & Color: ${world.lighting || "Volumetric production lighting"}, exhibiting a ${world.colorPalette || "balanced cinematic"} color palette.`;

  // 3. Fused Character Consistency
  const characterSegment = characters.map(c => {
    const basePrompt = c.characterPrompt ? c.characterPrompt.trim() : `A character named ${c.name}`;
    const expression = c.microExpression ? `with a subtle micro-expression of ${c.microExpression}` : "";
    const clothing = c.wardrobeColor ? `wearing wardrobe accented with ${c.wardrobeColor} colors` : "";
    return `[Character Active: ${c.name} - ${basePrompt} ${expression} ${clothing}]`;
  }).join(" ");

  // 4. Action & Dialogue Context
  const actionSegment = shot.action ? `Action Breakdown: ${shot.action}.` : "";
  const dialogueContext = shot.dialogue ? `Dialogue Beat: Spoken context implies tone of "${shot.dialogue}".` : "";

  // 5. Consolidated Clean Prompt Output
  const finalPrompt = `${worldStyle} ${cameraSegment} ${characterSegment} ${environmentSegment} ${lightingPalette} ${actionSegment} ${dialogueContext} ${world.masterPrompt || ""}`;
  
  return finalPrompt.replace(/\s+/g, " ").trim();
}
