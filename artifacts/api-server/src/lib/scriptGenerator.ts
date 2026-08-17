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
    "openai/gpt-oss-120b";

  const systemPrompt = `
You are a professional cinematic screenwriter, film director,
and continuity supervisor.

Create a production-ready cinematic screenplay from the USER IDEA.

LANGUAGE AND CULTURAL INTEGRITY:
1. Write all screenplay content in natural, fluent Modern Standard Arabic.
2. Never use Chinese, Japanese, Korean, Cyrillic, Hindi, or other foreign scripts.
3. Never mix English words into Arabic descriptions, dialogue, titles, or audio.
4. English is allowed only in englishSubtitles and cameraMovement.
5. Never create malformed mixed words such as "يapproachه".
6. Dialogue must be natural, grammatically correct Arabic.
7. Audio descriptions must be Arabic.
8. English subtitles must accurately translate the actual Arabic dialogue.

STORY QUALITY:
1. Treat USER IDEA as the single source of truth.
2. Preserve the user's characters, relationships, location, events, and premise.
3. Every scene must have a distinct narrative purpose.
4. Scene 2 must directly continue Scene 1.
5. Scene 3 must directly continue Scene 2.
6. Every scene must introduce meaningful new information or escalation.
7. The final scene must resolve, reveal, or significantly escalate the central conflict.
8. Do not invent unnecessary characters.
9. Do not contradict the user's idea.
10. Do not reveal the final mystery too early.

SHOT QUALITY:
1. Every shot must introduce a new visual action, discovery, reaction, movement, camera perspective, or story beat.
2. Never repeat a previous shot with different wording.
3. Every shot must advance the story.
4. Every shot must contain description, cameraMovement,
   durationSeconds, dialogue, and audioNote.
5. description must be a concrete visible action in Arabic.
6. cameraMovement must use professional terminology.
7. durationSeconds must be a positive number.
8. dialogue must match the action.
9. Use an empty string when there is no dialogue.
10. audioNote must describe specific Arabic sound or ambience.

CONTINUITY:
1. Keep characters, clothing, props, location, weather,
   lighting, time, and physical positions consistent.
2. Do not change continuity without a story reason.
3. Do not repeat visual descriptions unnecessarily.
4. Every scene must logically follow the previous scene.

SUBTITLES:
1. englishSubtitles must be an accurate English translation
   of the actual Arabic dialogue.
2. Never invent subtitle dialogue.
3. Never translate different dialogue.
4. If there is no dialogue, use an empty string.

OUTPUT:
1. Return ONLY valid JSON.
2. Do not return markdown or explanations.
3. Top-level fields must be exactly "title" and "scenes".
4. scenes must contain EXACTLY ${targetScenes} scenes.
5. Every scene must contain EXACTLY ${shotsPerScene} shots.
6. Scene numbers must be sequential starting at 1.
7. Shot numbers must restart at 1 for every scene.
8. Do not create extra scenes or shots.

Before returning JSON, internally verify:
- Correct scene count.
- Correct shot count.
- Sequential scene numbers.
- Sequential shot numbers.
- No duplicated scenes.
- No duplicated shots.
- No mixed-language corruption.
- Clear story progression.
- Character and location continuity.
- Dialogue and subtitles match.
- Every shot contains a new visual action.
- Final scene contains a meaningful cinematic development.

Required JSON structure:
{
  "title": "Arabic movie title",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneTitle": "Arabic scene title",
      "visualDescription": "Detailed Arabic visual description",
      "characterDialogue": "Complete Arabic dialogue",
      "backingScorePrompt": "Arabic music prompt",
      "audioMusic": "Arabic ambient sound and SFX",
      "englishSubtitles": "Accurate English translation",
      "shots": [
        {
          "shotOrder": 1,
          "description": "Specific Arabic visual action",
          "cameraMovement": "Professional camera movement",
          "durationSeconds": 10,
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

IMPORTANT PRODUCTION INSTRUCTIONS:

1. Treat the USER IDEA as the single source of truth for the story.
2. Write the screenplay entirely in natural, fluent Modern Standard Arabic.
3. English is allowed ONLY inside the englishSubtitles field.
4. Do NOT use Chinese, Japanese, Korean, Cyrillic, Hindi, or any other non-Arabic script.
5. Do NOT invent foreign words or transliterations.
6. Use standard professional film terminology for camera movements.
7. Every scene must have a DISTINCT narrative purpose.
8. Scene 2 must continue directly from Scene 1 and introduce meaningful new information.
9. Scene 3 must continue directly from Scene 2 and resolve, reveal, or significantly escalate the story.
10. NEVER copy a previous scene's visual description, dialogue, shot description, or audio description.
11. Do not repeat the same shot structure merely with different character names.
12. Every shot must introduce a new visual action, camera perspective, or story beat.
13. Keep characters, clothing, location, weather, lighting, time, and positions consistent.
14. Dialogue must sound like natural Arabic and match the action.
15. English subtitles must accurately translate the actual Arabic dialogue.
16. If a shot has no dialogue, use an empty string.
17. Keep descriptions concrete and cinematic.
18. Do not introduce unnecessary characters.
19. Do not repeat background elements just to fill space.
20. The final scene must contain a meaningful cinematic development or ending.

Before returning JSON, internally check:
- Correct number of scenes.
- Correct number of shots per scene.
- Sequential scene numbers.
- Sequential shot numbers.
- No duplicated scenes.
- No duplicated shots.
- No mixed-language corruption.
- Clear story progression.
- Dialogue and subtitles match.
- Every shot has a clear visual action.

Create the complete cinematic screenplay and detailed shot plan now.
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

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Groq returned an invalid JSON object.");
    }

    if (!Array.isArray(parsed.scenes)) {
      throw new Error("Groq response does not contain scenes.");
    }

    if (parsed.scenes.length !== targetScenes) {
      throw new Error(
        `Groq returned ${parsed.scenes.length} scenes instead of ${targetScenes}.`,
      );
    }

      const sceneFingerprints = new Set<string>();

      for (
        let sceneIndex = 0;
        sceneIndex < parsed.scenes.length;
        sceneIndex++
      ) {
        const scene = parsed.scenes[sceneIndex];

        if (!scene || typeof scene !== "object") {
          throw new Error(`Invalid scene at index ${sceneIndex}.`);
        }

        const expectedSceneNumber = sceneIndex + 1;

        if (Number(scene.sceneNumber) !== expectedSceneNumber) {
          throw new Error(
            `Scene ${sceneIndex + 1} has invalid sceneNumber: ${scene.sceneNumber}.`,
          );
        }

        if (
          typeof scene.sceneTitle !== "string" ||
          !scene.sceneTitle.trim()
        ) {
          throw new Error(
            `Scene ${sceneIndex + 1} has an empty sceneTitle.`,
          );
        }

        if (
          typeof scene.visualDescription !== "string" ||
          !scene.visualDescription.trim()
        ) {
          throw new Error(
            `Scene ${sceneIndex + 1} has an empty visualDescription.`,
          );
        }

        if (!Array.isArray(scene.shots)) {
          throw new Error(
            `Scene ${sceneIndex + 1} does not contain shots.`,
          );
        }

        if (scene.shots.length !== shotsPerScene) {
          throw new Error(
            `Scene ${sceneIndex + 1} returned ${scene.shots.length} shots instead of ${shotsPerScene}.`,
          );
        }

        const sceneFingerprint = [
          scene.sceneTitle,
          scene.visualDescription,
          scene.characterDialogue,
          scene.shots
            .map((shot: any) =>
              [
                shot?.description,
                shot?.dialogue,
                shot?.cameraMovement,
              ]
                .map((value) => String(value || "").trim())
                .join("|"),
            )
            .join("||"),
        ]
          .map((value) => String(value || "").trim().toLowerCase())
          .join("###");

        if (sceneFingerprints.has(sceneFingerprint)) {
          throw new Error(
            `Scene ${sceneIndex + 1} appears to duplicate another scene.`,
          );
        }

        sceneFingerprints.add(sceneFingerprint);

        for (
          let shotIndex = 0;
          shotIndex < scene.shots.length;
          shotIndex++
        ) {
          const shot = scene.shots[shotIndex];

          if (!shot || typeof shot !== "object") {
            throw new Error(
              `Scene ${sceneIndex + 1} contains an invalid shot.`,
            );
          }

          const expectedShotOrder = shotIndex + 1;

          if (Number(shot.shotOrder) !== expectedShotOrder) {
            throw new Error(
              `Scene ${sceneIndex + 1} shot ${shotIndex + 1} has invalid shotOrder: ${shot.shotOrder}.`,
            );
          }

          if (
            typeof shot.description !== "string" ||
            !shot.description.trim()
          ) {
            throw new Error(
              `Scene ${sceneIndex + 1} shot ${shotIndex + 1} has an empty description.`,
            );
          }

          if (
            typeof shot.cameraMovement !== "string" ||
            !shot.cameraMovement.trim()
          ) {
            throw new Error(
              `Scene ${sceneIndex + 1} shot ${shotIndex + 1} has an empty cameraMovement.`,
            );
          }

          if (
            !Number.isFinite(Number(shot.durationSeconds)) ||
            Number(shot.durationSeconds) <= 0
          ) {
            throw new Error(
              `Scene ${sceneIndex + 1} shot ${shotIndex + 1} has invalid durationSeconds.`,
            );
          }
        }
      }

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
