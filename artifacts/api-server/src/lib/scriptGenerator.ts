import { Groq } from "groq-sdk";

export interface GenerateScriptInput {
  idea: string;
  worldId: string;
  projectId: number;
  actors: Array<{
    id: number;
    name: string;
    type: string;
    age: number;
    style: string;
    role?: string;
    personality?: string;
    background?: string;
    appearance?: any;
    wardrobe?: any;
    characterPrompt?: string;
  }>;
  worldBible?: {
    era?: string; location?: string; geography?: string; architecture?: string;
    clothingStyle?: string; technology?: string; lighting?: string;
    colorPalette?: string; atmosphere?: string; weather?: string; visualStyle?: string;
    masterPrompt?: string;
  };
  previousContext?: string;
}

export interface GeneratedShot {
  shotOrder: number;
  description: string;
  cameraMovement: string;
  durationSeconds: number;
  dialogue: string;
  audioNote: string;
}

export interface GeneratedScene {
  sceneNumber: number;
  sceneTitle: string;
  visualDescription: string;
  characterDialogue: string;
  backingScorePrompt: string;
  audioMusic: string;
  englishSubtitles: string;
  shots: GeneratedShot[];
}

export interface GeneratedScript {
  title: string;
  scenes: GeneratedScene[];
}

export interface GenerateScriptResult {
  success: true;
  text: string;
  rawStructure: GeneratedScript;
}

export async function generateScript(
  input: GenerateScriptInput,
): Promise<GenerateScriptResult> {
  const { idea, worldId, actors, worldBible, previousContext } = input;
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    console.warn("GROQ_API_KEY is not configured.");
    return fallbackScriptGenerator(idea);
  }

  const groq = new Groq({ apiKey });
  const model = process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

  // Build centralized rich Character Context
  const characterBibleContext = actors.map(a => {
    return `[CHARACTER BIBLE: ${a.name}]
Role: ${a.role || 'Supporting'} | Age: ${a.age} | Group: ${a.type}
Appearance: Face: ${a.appearance?.face || 'Default'}, Eyes: ${a.appearance?.eyes || 'Default'}, Hair: ${a.appearance?.hair || 'Default'}, Style: ${a.appearance?.hairstyle || 'Default'}, Build: ${a.appearance?.bodyBuild || 'Default'}
Wardrobe: Outfit: ${a.wardrobe?.defaultClothing || 'Default'}, Colors: ${a.wardrobe?.colors || 'Default'}, Accessories: ${a.wardrobe?.accessories || 'None'}
Personality & Speaking: ${a.personality || 'Cinematic standard'} | Tone: ${a.style}
Visual AI Target Prompt: ${a.characterPrompt || ''}`;
  }).join("\n\n");

  // Build centralized rich World Context
  const worldBibleContext = `[WORLD BIBLE CONTEXT: ${worldId}]
Era: ${worldBible?.era || 'Contemporary'} | Location: ${worldBible?.location || 'Unknown'}
Geography & Architecture: ${worldBible?.geography || 'Standard'}, ${worldBible?.architecture || 'Modern'}
Lighting & Palette: ${worldBible?.lighting || 'Cinematic high-contrast'}, ${worldBible?.colorPalette || 'Realistic'}
Atmosphere & Visual Style: ${worldBible?.atmosphere || 'Dramatic'}, ${worldBible?.visualStyle || 'Netflix cinematic'}
Weather conditions: ${worldBible?.weather || 'Clear'}
Master AI Prompt Rule: ${worldBible?.masterPrompt || ''}`;

  const continuityPrompt = previousContext 
    ? `[CONTINUITY CONTEXT - PREVIOUS SCENES DEVELOPMENTS]:\n${previousContext}`
    : "No previous scene context available. This is the script genesis.";

  const systemPrompt = `
You are Kayan AI centralized Prompt & Screenplay Director Engine.

Generate a JSON script completely using Modern Standard Arabic for narrative/dialogue text.
Ensure perfect Character Consistency and Continuity by strictly enforcing the injected Character Bibles, Wardrobe sets, and World Bible parameters.

Validations:
1. Every shot visual description MUST fuse the character appearance, specific wardrobe colors, and the active weather/lighting parameters from the World Bible.
2. If the user narrative references a character name not present in the injected Bibles, immediately fail script structure.

Return format ONLY:
{
  "title": "Arabic title",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneTitle": "Arabic Title",
      "visualDescription": "Fused Arabic visual prompt combining current scene context, world lighting, and active clothing items",
      "characterDialogue": "Arabic dialogues",
      "backingScorePrompt": "Udio/Suno soundtrack prompt based on World Atmosphere",
      "audioMusic": "Arabic sfx guidelines",
      "englishSubtitles": "Translation of dialogue",
      "shots": [
        {
          "shotOrder": 1,
          "description": "Concrete Arabic vision block combining explicit character build/wardrobe and world atmosphere",
          "cameraMovement": "Cinematic camera path",
          "durationSeconds": 5,
          "dialogue": "Arabic spoken line",
          "audioNote": "SFX description"
        }
      ]
    }
  ]
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `IDEA:\n${idea}\n\n${characterBibleContext}\n\n${worldBibleContext}\n\n${continuityPrompt}` }
      ],
    });

    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    return {
      success: true,
      text: JSON.stringify(parsed, null, 2),
      rawStructure: parsed
    };
  } catch (e) {
    return fallbackScriptGenerator(idea);
  }
}

function fallbackScriptGenerator(idea: string): GenerateScriptResult {
  const fallback = {
    title: "Kayan Film",
    scenes: [{
      sceneNumber: 1,
      sceneTitle: "بداية المشهد",
      visualDescription: `مشهد سينمائي مع الحفاظ على اتساق المظهر: ${idea}`,
      characterDialogue: "",
      backingScorePrompt: "Cinematic atmospheric background score",
      audioMusic: "أصوات محيطية متناسقة",
      englishSubtitles: "",
      shots: [{
        shotOrder: 1,
        description: "لقطة سينمائية تدمج الشخصيات والمظهر المختار",
        cameraMovement: "Slow tracking shot",
        durationSeconds: 5,
        dialogue: "",
        audioNote: "أصوات طبيعية"
      }]
    }]
  };
  return { success: true, text: JSON.stringify(fallback), rawStructure: fallback };
}
