import { Groq } from "groq-sdk";

export interface GenerateScriptInput {
  idea: string;
  worldId: string;
  actors: Array<{
    name: string;
    type: string;
    age: number;
    style: string;
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

  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    console.warn("GROQ_API_KEY is not configured.");
    return fallbackScriptGenerator(idea);
  }

  const groq = new Groq({ apiKey });

  const actorsList =
    actors.length > 0
      ? actors
          .map(
            (actor) =>
              `${actor.name} (${actor.age} years old, ${actor.type}, ${actor.style})`,
          )
          .join(", ")
      : "No predefined characters.";

  const model =
    process.env.GROQ_MODEL?.trim() ||
    "llama-3.3-70b-versatile";

  const systemPrompt = `
You are a professional cinematic screenwriter and AI film director.

Create a complete cinematic screenplay from the user's idea.

The input can be a simple idea, legend, myth, historical event, story, or existing screenplay.

Expand incomplete ideas creatively while preserving the core concept.

Return ONLY valid JSON.

Required structure:

{
  "title": "Movie title",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneTitle": "Scene title",
      "visualDescription": "Detailed cinematic visual description",
      "characterDialogue": "Arabic dialogue with speaker names",
      "backingScorePrompt": "Music generation prompt",
      "audioMusic": "Ambient and SFX notes",
      "englishSubtitles": "English subtitle translation",
      "shots": [
        {
          "shotOrder": 1,
          "description": "Detailed visual description of this exact shot",
          "cameraMovement": "Professional cinematic camera movement",
          "durationSeconds": 5,
          "dialogue": "Dialogue for this shot",
          "audioNote": "Specific sound effects"
        }
      ]
    }
  ]
}

Every scene must contain multiple shots.

Maintain continuity of:
- characters
- costumes
- locations
- lighting
- time
- atmosphere

Use professional cinematic camera terminology.
`;

  const userPrompt = `
USER IDEA:
${idea}

CINEMATIC WORLD:
${worldId}

AVAILABLE CHARACTERS:
${actorsList}

GENRE:
${settings?.genre || "Cinematic Drama"}

TARGET SCENES:
${settings?.targetScenes || "Flexible"}

TARGET DURATION:
${settings?.durationMinutes || "Flexible"} minutes

Create the complete cinematic screenplay and detailed shot plan.
Write professional Arabic dialogue where appropriate.
`;

  try {
    const completion =
      await groq.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 12000,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

    const content =
      completion.choices?.[0]?.message?.content?.trim() ||
      "{}";

    const parsed = JSON.parse(content);

    const scriptData: GeneratedScript = {
      title:
        typeof parsed.title === "string" &&
        parsed.title.trim()
          ? parsed.title.trim()
          : "Kayan AI Film",

      scenes: Array.isArray(parsed.scenes)
        ? parsed.scenes.map(
            (scene: any, sceneIndex: number) => ({
              sceneNumber:
                Number(scene.sceneNumber) ||
                sceneIndex + 1,

              sceneTitle:
                String(scene.sceneTitle || "").trim() ||
                `Scene ${sceneIndex + 1}`,

              visualDescription:
                String(
                  scene.visualDescription || "",
                ).trim(),

              characterDialogue:
                String(
                  scene.characterDialogue || "",
                ).trim(),

              backingScorePrompt:
                String(
                  scene.backingScorePrompt || "",
                ).trim(),

              audioMusic:
                String(
                  scene.audioMusic || "",
                ).trim(),

              englishSubtitles:
                String(
                  scene.englishSubtitles || "",
                ).trim(),

              shots: Array.isArray(scene.shots)
                ? scene.shots.map(
                    (shot: any, shotIndex: number) => ({
                      shotOrder:
                        Number(shot.shotOrder) ||
                        shotIndex + 1,

                      description:
                        String(
                          shot.description || "",
                        ).trim(),

                      cameraMovement:
                        String(
                          shot.cameraMovement ||
                            "Cinematic slow push-in",
                        ).trim(),

                      durationSeconds:
                        Number(
                          shot.durationSeconds,
                        ) > 0
                          ? Math.round(
                              Number(
                                shot.durationSeconds,
                              ),
                            )
                          : 5,

                      dialogue:
                        String(
                          shot.dialogue || "",
                        ).trim(),

                      audioNote:
                        String(
                          shot.audioNote || "",
                        ).trim(),
                    }),
                  )
                : [],
            }),
          )
        : [],
    };

    return {
      success: true,
      text: formatScriptText(scriptData),
      rawStructure: scriptData,
    };
  } catch (error) {
    console.error(
      "Groq script generation failed:",
      error,
    );

    return fallbackScriptGenerator(idea);
  }
}

function formatScriptText(
  script: GeneratedScript,
): string {
  let text =
    `🎬 TITLE: ${script.title}\n\n`;

  for (const scene of script.scenes) {
    text +=
      `[SCENE ${scene.sceneNumber}] - ${scene.sceneTitle}\n`;

    text +=
      `VISUAL: ${scene.visualDescription}\n`;

    text +=
      `DIALOGUE:\n${scene.characterDialogue}\n`;

    text +=
      `SUBTITLE: ${scene.englishSubtitles}\n`;

    text +=
      `BACKING SCORE: ${scene.backingScorePrompt}\n`;

    text +=
      `AUDIO NOTES: ${scene.audioMusic}\n`;

    for (const shot of scene.shots) {
      text +=
        `[SHOT ${shot.shotOrder}] ` +
        `${shot.description}\n`;

      text +=
        `CAMERA: ${shot.cameraMovement}\n`;

      text +=
        `DURATION: ${shot.durationSeconds}s\n`;

      if (shot.dialogue) {
        text +=
          `DIALOGUE: ${shot.dialogue}\n`;
      }

      if (shot.audioNote) {
        text +=
          `AUDIO: ${shot.audioNote}\n`;
      }

      text += "\n";
    }

    text += "\n";
  }

  return text;
}

function fallbackScriptGenerator(
  idea: string,
): GenerateScriptResult {
  const script: GeneratedScript = {
    title: "Kayan AI Film",
    scenes: [
      {
        sceneNumber: 1,
        sceneTitle: "Opening",
        visualDescription:
          "Cinematic opening based on the user's idea.",
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
