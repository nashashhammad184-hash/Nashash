import { Groq } from "groq-sdk";

export interface GenerateScriptInput {
  idea: string;
  worldId: string;
  actors: Array<{
    name: string;
    type: string;
    age: number;
    style: string;
    gender?: string;
    eyeColor?: string;
    hairStyle?: string;
    physicalDescription?: string;
    personalityTraits?: string;
    backstory?: string;
    clothingPrompt?: string;
    characterMasterPrompt?: string;
  }>;
  settings?: {
    durationMinutes?: number;
    targetScenes?: number;
    genre?: string;
  };
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
  const { idea, worldId, actors, settings } = input;

  const targetScenes = Math.max(
    1,
    Math.min(6, Math.round(Number(settings?.targetScenes) || 2)),
  );

  const targetDurationMinutes = Math.max(
    1,
    Math.min(10, Math.round(Number(settings?.durationMinutes) || 1)),
  );

  const targetDurationSeconds = targetDurationMinutes * 60;

  const shotsPerScene = Math.max(
    2,
    Math.min(
      5,
      Math.ceil(targetDurationSeconds / targetScenes / 15),
    ),
  );

  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    console.warn("GROQ_API_KEY is not configured.");
    return fallbackScriptGenerator(idea);
  }

  const groq = new Groq({ apiKey });

  // دمج ملامح وصفات الـ Character Bible الكاملة لتوثيق وتثبيت أداء الممثل في السيناريو
  const actorsList =
    actors.length > 0
      ? actors
          .map(
            (actor) =>
              `- الممثل: ${actor.name} (${actor.age} سنة, ${actor.type})
                * الملامح الجسدية الثابتة: ${actor.physicalDescription || actor.style}
                * لون العينين والشعر: ${actor.eyeColor || 'تلقائي'} / ${actor.hairStyle || 'تلقائي'}
                * المظهر والملابس الافتراضية: ${actor.clothingPrompt || 'سينمائي كلاسيكي'}
                * السلوك وبناء الهوية النفسية: ${actor.personalityTraits || 'كاريزمي غامض'}
                * برومبت التثبيت البصري للوجه (AI Anchor): ${actor.characterMasterPrompt || 'Hyper-realistic dynamic rendering'}`
          )
          .join("\n\n")
      : "لا توجد شخصيات مسبقة التعيين.";

  const model =
    process.env.GROQ_MODEL?.trim() ||
    "llama-3.1-8b-instant";

  const systemPrompt = `
You are a professional cinematic screenwriter, film director, and continuity supervisor for "Kayan AI Productions".
Create a production-ready cinematic screenplay from the USER IDEA.

STRICT ACTOR BIBLE COMPLIANCE:
1. You MUST maintain the visual identity, clothing style, and psychological profiles of the assigned actors provided below.
2. Ensure their dialogues and actions match their listed personality traits.
3. In shot descriptions, reference their specific physical attributes and hair/eye styles to enforce absolute visual consistency across shots.

LANGUAGE AND CULTURAL INTEGRITY:
1. Write all screenplay content in natural, fluent Modern Standard Arabic.
2. English is allowed ONLY in englishSubtitles and cameraMovement.
3. Dialogue must be natural, grammatically correct Arabic.

STORY QUALITY & SHOT CONTINUITY:
1. Every shot must advance the story and introduce a new visual action or camera perspective.
2. Keep background, lighting, and actor positions completely consistent across consecutive shots.

Required JSON structure:
{
  "title": "Arabic movie title",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneTitle": "Arabic scene title",
      "visualDescription": "Detailed Arabic visual description using actor attributes",
      "characterDialogue": "Complete Arabic dialogue matching actor profiles",
      "backingScorePrompt": "Arabic music prompt",
      "audioMusic": "Arabic ambient sound and SFX",
      "englishSubtitles": "Accurate English translation of Arabic dialogue",
      "shots": [
        {
          "shotOrder": 1,
          "description": "Specific Arabic visual action describing the actor's facial anchors",
          "cameraMovement": "Professional camera movement",
          "durationSeconds": 5,
          "dialogue": "Arabic dialogue or empty string",
          "audioNote": "Specific Arabic audio and SFX"
        }
      ]
    }
  ]
}
`;

  const userPrompt = `
USER IDEA:
${idea}

CINEMATIC WORLD ENGINE (WORLD BIBLE LAWS):
${worldId}

CRITICAL WORLD BIBLE RULE:
You must treat the cinematic world details (Era, Visual Style, Lighting, Color Grading, Architecture, Atmosphere, Master Prompt) as absolute environment laws. For EVERY scene and shot, you MUST explicitly bake these visual style, lighting direction, and architectural backdrop elements directly into the description and camera prompts to preserve spatial continuity and guarantee a locked atmospheric aesthetic across the entire generation lifecycle.

CHARACTER BIBLE PROFILES (STRICT ADHERENCE REQUIRED):
${actorsList}

GENRE: ${settings?.genre || "Cinematic Drama"}
TARGET SCENES: ${targetScenes}
TARGET DURATION: ${targetDurationMinutes} minutes

Create the complete cinematic screenplay and detailed shot plan complying perfectly with the character profiles now.
`;

  try {
    const completion =
      await groq.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 4000,
        response_format: {
          type: "json_object",
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

    const content = completion.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(content);

    const scriptData: GeneratedScript = {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Kayan AI Film",
      scenes: Array.isArray(parsed.scenes)
        ? parsed.scenes.map((scene: any, sceneIndex: number) => ({
              sceneNumber: Number(scene.sceneNumber) || sceneIndex + 1,
              sceneTitle: String(scene.sceneTitle || "").trim() || `Scene ${sceneIndex + 1}`,
              visualDescription: String(scene.visualDescription || "").trim(),
              characterDialogue: String(scene.characterDialogue || "").trim(),
              backingScorePrompt: String(scene.backingScorePrompt || "").trim(),
              audioMusic: String(scene.audioMusic || "").trim(),
              englishSubtitles: String(scene.englishSubtitles || "").trim(),
              shots: Array.isArray(scene.shots)
                ? scene.shots.map((shot: any, shotIndex: number) => ({
                      shotOrder: Number(shot.shotOrder) || shotIndex + 1,
                      description: String(shot.description || "").trim(),
                      cameraMovement: String(shot.cameraMovement || "Cinematic slow push-in").trim(),
                      durationSeconds: Number(shot.durationSeconds) > 0 ? Math.round(Number(shot.durationSeconds)) : 5,
                      dialogue: String(shot.dialogue || "").trim(),
                      audioNote: String(shot.audioNote || "").trim(),
                    }))
                : [],
            }))
        : [],
    };

    return {
      success: true,
      text: formatScriptText(scriptData),
      rawStructure: scriptData,
    };
  } catch (error) {
    console.error("Groq script generation failed:", error);
    return fallbackScriptGenerator(idea);
  }
}

function formatScriptText(script: GeneratedScript): string {
  let text = `🎬 TITLE: ${script.title}\n\n`;
  for (const scene of script.scenes) {
    text += `[SCENE ${scene.sceneNumber}] - ${scene.sceneTitle}\n`;
    text += `VISUAL: ${scene.visualDescription}\n`;
    text += `DIALOGUE:\n${scene.characterDialogue}\n`;
    text += `SUBTITLE: ${scene.englishSubtitles}\n`;
    text += `BACKING SCORE: ${scene.backingScorePrompt}\n`;
    text += `AUDIO NOTES: ${scene.audioMusic}\n`;
    for (const shot of scene.shots) {
      text += `[SHOT ${shot.shotOrder}] ${shot.description}\n`;
      text += `CAMERA: ${shot.cameraMovement}\n`;
      text += `DURATION: ${shot.durationSeconds}s\n`;
      if (shot.dialogue) text += `DIALOGUE: ${shot.dialogue}\n`;
      if (shot.audioNote) text += `AUDIO: ${shot.audioNote}\n`;
      text += "\n";
    }
    text += "\n";
  }
  return text;
}

function fallbackScriptGenerator(idea: string): GenerateScriptResult {
  const script: GeneratedScript = {
    title: "Kayan AI Film",
    scenes: [
      {
        sceneNumber: 1,
        sceneTitle: "Opening",
        visualDescription: "Cinematic opening based on the user's idea.",
        characterDialogue: "",
        backingScorePrompt: "",
        audioMusic: "",
        englishSubtitles: "",
        shots: [
          {
            shotOrder: 1,
            description: "Establishing shot matching the concept: " + idea,
            cameraMovement: "Wide slow pan",
            durationSeconds: 5,
            dialogue: "",
            audioNote: ""
          }
        ]
      }
    ]
  };
  return {
    success: true,
    text: formatScriptText(script),
    rawStructure: script
  };
}
