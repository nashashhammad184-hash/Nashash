import { Groq } from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ""
});

interface GenerateScriptInput {
  idea: string;
  worldId: string;
  actors: Array<{ name: string; type: string; age: number; style: string }>;
  settings?: {
    durationMinutes?: number;
    targetScenes?: number;
    genre?: string;
  };
}

export async function generateScript(input: GenerateScriptInput) {
  const { idea, worldId, actors, settings } = input;
  
  if (!process.env.GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY غير مضبوط، سيتم التراجع إلى محرك افتراضي لتجنب الانهيار.");
    return fallbackScriptGenerator(idea, actors);
  }

  const actorsList = actors.map(a => `${a.name} (${a.age} سنة، طراز: ${a.style})`).join(", ");
  
  const systemPrompt = `You are an expert cinematic screenwriter, researcher, and co-creator in an AI filmmaking studio. 
Your task is to collaborate with the user. The user's input might be a fully detailed script or just a rough idea/historical legend/myth.
If it is a rough idea/legend, you must creatively expand it, write the full plotline, dramatize the scenes, and build the dialogue to assist them.
If it is a complete script, break it down structurally.
In both cases, split the story into detailed scenes and multiple specific shot plans.
You must return your response STRICTLY as a valid JSON object matching this TypeScript structure:
{
  "title": "Movie Title",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneTitle": "Scene Title",
      "visualDescription": "Detailed visual setup of the setting and action",
      "characterDialogue": "Dialogue text with speaker names in Arabic",
      "backingScorePrompt": "AI Music generator prompt for the atmosphere",
      "audioMusic": "SFX notes",
      "englishSubtitles": "English subtitles translation of the dialogue",
      "shots": [
        {
          "shotOrder": 1,
          "description": "Visual details of what happens in this specific shot",
          "cameraMovement": "Cinematic camera movement (e.g., cinematic drone pan, slow push-in, tracking shot)",
          "durationSeconds": 5,
          "dialogue": "Spoken sentence if any in this shot",
          "audioNote": "Specific sound effect for this shot"
        }
      ]
    }
  ]
}`;

  const userPrompt = `
  User Input (Full story or rough legend/idea): ${idea}
  Cinematic World Profile Context: ${worldId}
  Available Main Actors/Characters: [ ${actorsList} ]
  Target Production Settings:
  - Scenes Count: ${settings?.targetScenes || "Flexible based on story length"}
  - Film Genre: ${settings?.genre || "Cinematic Drama"}
  
  Collaborate with the user, expand the legend/idea if needed, write professional Arabic dialogue, and generate a deep, engaging screenplay matching the JSON schema provided. Ensure multiple detailed shots per scene for high-quality video generation.`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama3-8b-8192",
      response_format: { type: "json_object" }
    });

    const responseContent = chatCompletion.choices?.message?.content || "{}";
    const scriptData = JSON.parse(responseContent);
    
    let formattedText = `🎬 TITLE: ${scriptData.title || "Kayan AI Film Production"}\n\n`;
    
    if (scriptData.scenes && Array.isArray(scriptData.scenes)) {
      scriptData.scenes.forEach((scene: any) => {
        formattedText += `[SCENE ${scene.sceneNumber}] - ${scene.sceneTitle}\n`;
        formattedText += `VISUAL: ${scene.visualDescription}\n`;
        formattedText += `DIALOGUE:\n${scene.characterDialogue}\n`;
        formattedText += `SUBTITLE: ${scene.englishSubtitles || ""}\n`;
        formattedText += `BACKING SCORE: ${scene.backingScorePrompt || ""}\n`;
        formattedText += `AUDIO NOTES: ${scene.audioMusic || ""}\n\n`;
      });
    }

    return {
      success: true,
      text: formattedText,
      rawStructure: scriptData
    };

  } catch (error) {
    console.error("❌ فشل محرك الذكاء الاصطناعي في توليد القصة:", error);
    return fallbackScriptGenerator(idea, actors);
  }
}

function fallbackScriptGenerator(idea: string, actors: any[]) {
  return {
    success: true,
    text: `🎬 فيلم: قصة من إنتاج كيان السينمائي\n\nالفكرة الأساسية: ${idea}\n\n[SCENE 1] - الافتتاحية\nالمشهد الافتتاحي للقصة بناءً على رؤيتك الفنية وممثليك الاستوديو.`,
    rawStructure: { title: "Kayan Film", scenes: [] }
  };
}
