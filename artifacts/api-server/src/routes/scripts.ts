import { Router, type IRouter } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, scriptsTable, shotsTable, actorsTable } from "@workspace/db";
import { ListProjectScriptsParams, ListProjectScriptsResponse, GenerateScriptResponse } from "@workspace/api-zod";
import { generateScript } from "../lib/scriptGenerator";
import Groq from "groq-sdk";
import * as zod from "zod";

const router: IRouter = Router();

const DynamicScriptGenerateBody = zod.object({
  projectId: zod.number(),
  idea: zod.string().min(1),
  worldId: zod.string(),
  actors: zod.array(zod.union([zod.string(), zod.number()])).optional(),
  durationMinutes: zod.number().optional(),
  targetScenes: zod.number().optional(),
  genre: zod.string().optional()
});

router.get(
  "/projects/:id/scripts",
  async (req, res): Promise<void> => {
    const params = ListProjectScriptsParams.safeParse(req.params);

    if (!params.success) {
      res.status(400).json({
        error: params.error.message,
      });
      return;
    }

    const scripts = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.projectId, params.data.id))
      .orderBy(desc(scriptsTable.createdAt));

    res.json(
      ListProjectScriptsResponse.parse(
        scripts.map((script) => ({
          ...script,
          createdAt: script.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.post(
  "/scripts/generate",
  async (req, res): Promise<void> => {
    const parsed = DynamicScriptGenerateBody.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.message,
      });
      return;
    }

    const {
      projectId,
      idea,
      worldId,
      actors,
      durationMinutes,
      targetScenes,
      genre,
    } = parsed.data;

    let normalizedActors: Array<{
      name: string;
      type: string;
      age: number;
      style: string;
    }> = [];

    if (actors && actors.length > 0) {
      const actorIds = actors.filter((a): a is number => typeof a === "number");
      const actorNames = actors.filter((a): a is string => typeof a === "string");

      if (actorIds.length > 0) {
        const dbActorsById = await db
          .select()
          .from(actorsTable)
          .where(inArray(actorsTable.id, actorIds));

        dbActorsById.forEach(actor => {
          normalizedActors.push({
            name: actor.name,
            type: actor.type,
            age: actor.age,
            style: actor.style,
          });
        });
      }

      if (actorNames.length > 0) {
        const dbActorsByName = await db
          .select()
          .from(actorsTable)
          .where(inArray(actorsTable.name, actorNames));

        dbActorsByName.forEach(actor => {
          if (!normalizedActors.some(a => a.name === actor.name)) {
            normalizedActors.push({
              name: actor.name,
              type: actor.type,
              age: actor.age,
              style: actor.style,
            });
          }
        });
      }
    }

    const generated = await generateScript({
      idea,
      worldId,
      actors: normalizedActors,
      settings: {
        durationMinutes: durationMinutes ?? 1,
        targetScenes: targetScenes ?? 2,
        genre: genre ?? "drama",
      },
    });

    const [script] = await db
      .insert(scriptsTable)
      .values({
        projectId,
        idea,
        worldId,
        generatedContent: generated.text,
      })
      .returning();

    if (!script) {
      res.status(500).json({
        error: "Failed to save generated script.",
      });
      return;
    }

    for (const scene of generated.rawStructure.scenes) {
      for (const shot of scene.shots) {
        if (!shot.description.trim()) {
          continue;
        }

        await db
          .insert(shotsTable)
          .values({
            projectId,
            scriptId: script.id,
            sceneNumber: scene.sceneNumber,
            shotOrder: shot.shotOrder,
            description: shot.description,
            cameraMovement: shot.cameraMovement || "Cinematic slow push-in",
            durationSeconds: shot.durationSeconds > 0 ? Math.round(shot.durationSeconds) : 5,
            dialogue: shot.dialogue || null,
            audioNote: shot.audioNote || null,
          });
      }
    }

    res.status(201).json(
      GenerateScriptResponse.parse({
        ...script,
        createdAt: script.createdAt.toISOString(),
      }),
    );
  },
);

function fallbackProductionPrompt(
  shots: Array<{
    sceneNumber: number;
    description: string;
    cameraMovement: string;
    dialogue: string | null;
    durationSeconds: number | null;
  }>,
): string {
  return shots
    .map((shot) =>
      [
        `Scene ${shot.sceneNumber}`,
        `Visual: ${shot.description}`,
        `Camera: ${shot.cameraMovement}`,
        shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
        `Duration: ${shot.durationSeconds ?? 5} seconds`,
      ]
        .filter(Boolean)
        .join(". "),
    )
    .join("\n");
}

// هنا تم الإصلاح: معالجة الطلب بالكامل باستخدام Groq SDK الرسمي الصحيح وتوجيهه لـ Endpoint توليد النصوص
async function translateProductionPrompt(
  prompt: string,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    return prompt;
  }

  try {
    // تهيئة عميل الـ SDK الرسمي باستخدام المفتاح الخاص بك المعتمد بالسيرفر
    const groq = new Groq({ apiKey });
    const model = process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

    const chatCompletion = await groq.chat.completions.create({
      model: model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: "Translate the production prompt to concise cinematic English. Preserve scene order, dialogue meaning, camera movement, and durations. Return only the prompt.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return chatCompletion.choices[0]?.message?.content?.trim() || prompt;
  } catch (error) {
    // تسجيل الخطأ الفعلي بداخل الـ Terminal ومسجل النظام للتحليل، وإرجاع الـ fallback prompt لحماية تجربة الاستخدام
    console.error("Groq API Error in translateProductionPrompt:", error);
    return prompt;
  }
}

router.get(
  "/projects/:id/production-prompt",
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.id);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({
        error: "A valid project id is required.",
      });
      return;
    }

    const shots = await db
      .select({
        sceneNumber: shotsTable.sceneNumber,
        description: shotsTable.description,
        cameraMovement: shotsTable.cameraMovement,
        dialogue: shotsTable.dialogue,
        durationSeconds: shotsTable.durationSeconds,
      })
      .from(shotsTable)
      .where(eq(shotsTable.projectId, projectId))
      .orderBy(asc(shotsTable.sceneNumber));

    if (shots.length === 0) {
      res.json({
        prompt: "",
        source: "fallback",
      });
      return;
    }

    const sourcePrompt = fallbackProductionPrompt(shots);

    const prompt = await translateProductionPrompt(sourcePrompt);

    res.json({
      prompt,
      source: prompt === sourcePrompt ? "fallback" : "director",
    });
  },
);

export default router;
