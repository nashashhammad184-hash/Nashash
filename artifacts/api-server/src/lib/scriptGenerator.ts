import { getScriptProvider } from "./providers/script/factory";

export interface GenerateScriptInput {
  idea: string;
  worldId: string;
  projectId: number;
  actors: Array<{
    id: number; name: string; type: string; age: number; style: string;
    role?: string; personality?: string; background?: string;
    appearance?: any; wardrobe?: any; characterPrompt?: string;
  }>;
  worldBible?: {
    era?: string; location?: string; geography?: string; architecture?: string;
    clothingStyle?: string; technology?: string; lighting?: string;
    colorPalette?: string; atmosphere?: string; weather?: string;
    visualStyle?: string; masterPrompt?: string;
  };
  previousContext?: string;
}

export interface GeneratedShot {
  shotOrder: number; description: string; cameraMovement: string;
  durationSeconds: number; dialogue: string; audioNote: string;
}
export interface GeneratedScene {
  sceneNumber: number; sceneTitle: string; visualDescription: string;
  characterDialogue: string; backingScorePrompt: string; audioMusic: string;
  englishSubtitles: string; shots: GeneratedShot[];
}
export interface GeneratedScript { title: string; scenes: GeneratedScene[]; }
export interface GenerateScriptResult {
  success: true; text: string; rawStructure: GeneratedScript;
}

export async function generateScript(input: GenerateScriptInput): Promise<GenerateScriptResult> {
  const { idea, worldId, actors, worldBible, previousContext } = input;

  const characterBibleContext = actors.map(a => {
    return `[CHARACTER BIBLE: ${a.name}]
Role: ${a.role || "Supporting"} | Age: ${a.age} | Group: ${a.type}
Appearance: Face: ${a.appearance?.face || "Default"}, Eyes: ${a.appearance?.eyes || "Default"}, Hair: ${a.appearance?.hair || "Default"}, Style: ${a.appearance?.hairstyle || "Default"}
Wardrobe: Outfit: ${a.wardrobe?.defaultClothing || "Default"}, Colors: ${a.wardrobe?.colors || "Default"}`;
  }).join("\n\n");

  const worldBibleContext = `[WORLD BIBLE CONTEXT: ${worldId}]
Era: ${worldBible?.era || "Contemporary"} | Location: ${worldBible?.location || "Unknown"}
Geography & Architecture: ${worldBible?.geography || "Standard"}, ${worldBible?.architecture || "Modern"}
Lighting & Palette: ${worldBible?.lighting || "Cinematic"}, ${worldBible?.colorPalette || "Realistic"}`;

  const continuityPrompt = previousContext
    ? `[CONTINUITY CONTEXT]:\n${previousContext}`
    : "This is the script genesis.";

  const schemaJson = {
    type: "object",
    properties: {
      title: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sceneNumber: { type: "integer" },
            sceneTitle: { type: "string" },
            visualDescription: { type: "string" },
            characterDialogue: { type: "string" },
            backingScorePrompt: { type: "string" },
            audioMusic: { type: "string" },
            englishSubtitles: { type: "string" },
            shots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  shotOrder: { type: "integer" },
                  description: { type: "string" },
                  cameraMovement: { type: "string" },
                  durationSeconds: { type: "number" },
                  dialogue: { type: "string" },
                  audioNote: { type: "string" }
                },
                required: ["shotOrder","description","cameraMovement","durationSeconds","dialogue","audioNote"]
              }
            }
          },
          required: ["sceneNumber","sceneTitle","visualDescription","characterDialogue","backingScorePrompt","audioMusic","englishSubtitles","shots"]
        }
      }
    },
    required: ["title","scenes"]
  };

  const detectedLang: "ar" | "en" = /[\u0600-\u06FF]/.test(idea) ? "ar" : "en";
  const constraints = detectedLang === "ar"
    ? `[قيود صارمة]:
- اكتب بين 3 و 5 مشاهد فقط. لا تتجاوز 5 إطلاقًا.
- لا تكرر نفس sceneTitle أو visualDescription في أي مشهدين.
- كل مشهد يجب أن يدفع القصة للأمام — لا حشو ولا حلقات.
- أنهِ الـ JSON بشكل نظيف بعد آخر مشهد.
- استخدم علامات ترقيم عربية قياسية فقط (. ، ؟ ! : ؛ -).`
    : `[STRICT CONSTRAINTS]:
- Produce between 3 and 5 scenes. Never exceed 5.
- Do NOT repeat sceneTitle or visualDescription across scenes.
- Every scene must advance the story — no filler, no loops.
- End the JSON cleanly after the last scene.
- Use only standard punctuation (. , ? ! : ; -).`;

  const userPrompt = `IDEA:\n${idea}\n\n${characterBibleContext}\n\n${worldBibleContext}\n\n${continuityPrompt}\n\n${constraints}`;

  const provider = getScriptProvider();
  const res = await provider.generate({
    task: "structured",
    prompt: userPrompt,
    language: detectedLang,
    schemaJson,
    maxTokens: 2500,
    temperature: 0.5,
  });

  let raw = res.content.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  // إزالة أي أحرف CJK (صينية/يابانية/كورية) تُقحم في النص العربي
  raw = raw.replace(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/g, "");
  const parsed: GeneratedScript = JSON.parse(raw);

  return { success: true, text: JSON.stringify(parsed, null, 2), rawStructure: parsed };
}
