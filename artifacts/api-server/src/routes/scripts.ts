import { Router, type IRouter } from "express";
import {
  asc,
  desc,
  eq,
} from "drizzle-orm";

import {
  db,
  scriptsTable,
  shotsTable,
} from "@workspace/db";

import {
  ListProjectScriptsParams,
  ListProjectScriptsResponse,
  GenerateScriptBody,
  GenerateScriptResponse,
} from "@workspace/api-zod";

import {
  generateScript,
} from "../lib/scriptGenerator";

const router: IRouter = Router();

router.get(
  "/projects/:id/scripts",
  async (req, res): Promise<void> => {
    const params =
      ListProjectScriptsParams.safeParse(
        req.params,
      );

    if (!params.success) {
      res.status(400).json({
        error: params.error.message,
      });
      return;
    }

    const scripts = await db
      .select()
      .from(scriptsTable)
      .where(
        eq(
          scriptsTable.projectId,
          params.data.id,
        ),
      )
      .orderBy(
        desc(scriptsTable.createdAt),
      );

    res.json(
      ListProjectScriptsResponse.parse(
        scripts.map((script) => ({
          ...script,
          createdAt:
            script.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.post(
  "/scripts/generate",
  async (req, res): Promise<void> => {
    const parsed =
      GenerateScriptBody.safeParse(
        req.body,
      );

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
    } = parsed.data;

    /*
     * The current API contract provides actor names.
     * Convert them into the richer structure expected
     * by the cinematic script generator.
     */
    const normalizedActors =
      (actors ?? []).map((name) => ({
        name,
        type: "supporting",
        age: 30,
        style:
          "cinematic naturalistic",
      }));

    const generated =
      await generateScript({
        idea,
        worldId,
        actors: normalizedActors,
      });

    const [script] = await db
      .insert(scriptsTable)
      .values({
        projectId,
        idea,
        worldId,
        generatedContent:
          generated.text,
      })
      .returning();

    if (!script) {
      res.status(500).json({
        error:
          "Failed to save generated script.",
      });
      return;
    }

    /*
     * Persist every AI-generated shot
     * as a real database record.
     */
    for (const scene of
      generated.rawStructure.scenes) {
      for (const shot of scene.shots) {
        if (!shot.description.trim()) {
          continue;
        }

        await db
          .insert(shotsTable)
          .values({
            projectId,
            scriptId: script.id,
            sceneNumber:
              scene.sceneNumber,
            description:
              shot.description,
            cameraMovement:
              shot.cameraMovement ||
              "Cinematic slow push-in",
            durationSeconds:
              shot.durationSeconds > 0
                ? Math.round(
                    shot.durationSeconds,
                  )
                : 5,
            dialogue:
              shot.dialogue || null,
            audioNote:
              shot.audioNote || null,
          });
      }
    }

    res.status(201).json(
      GenerateScriptResponse.parse({
        ...script,
        createdAt:
          script.createdAt.toISOString(),
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
        shot.dialogue
          ? `Dialogue: ${shot.dialogue}`
          : "",
        `Duration: ${
          shot.durationSeconds ?? 5
        } seconds`,
      ]
        .filter(Boolean)
        .join(". "),
    )
    .join("\n");
}

async function translateProductionPrompt(
  prompt: string,
): Promise<string> {
  const apiKey =
    process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    return prompt;
  }

  try {
    const response = await fetch(
      "https://groq.com",
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${apiKey}`,
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.GROQ_MODEL?.trim() ||
            "llama-3.1-8b-instant",
          temperature: 0.1,
          max_tokens: 900,
          messages: [
            {
              role: "system",
              content:
                "Translate the production prompt to concise cinematic English. Preserve scene order, dialogue meaning, camera movement, and durations. Return only the prompt.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
        signal:
          AbortSignal.timeout(8000),
      },
    );

    if (!response.ok) {
      return prompt;
    }

    const payload =
      (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

    return (
      payload.choices?.[0]?.message
        ?.content?.trim() || prompt
    );
  } catch {
    return prompt;
  }
}

router.get(
  "/projects/:id/production-prompt",
  async (req, res): Promise<void> => {
    const projectId =
      Number(req.params.id);

    if (
      !Number.isInteger(projectId) ||
      projectId <= 0
    ) {
      res.status(400).json({
        error:
          "A valid project id is required.",
      });
      return;
    }

    const shots = await db
      .select({
        sceneNumber:
          shotsTable.sceneNumber,
        description:
          shotsTable.description,
        cameraMovement:
          shotsTable.cameraMovement,
        dialogue:
          shotsTable.dialogue,
        durationSeconds:
          shotsTable.durationSeconds,
      })
      .from(shotsTable)
      .where(
        eq(
          shotsTable.projectId,
          projectId,
        ),
      )
      .orderBy(
        asc(shotsTable.sceneNumber),
      );

    if (shots.length === 0) {
      res.json({
        prompt: "",
        source: "fallback",
      });
      return;
    }

    const sourcePrompt =
      fallbackProductionPrompt(shots);

    const prompt =
      await translateProductionPrompt(
        sourcePrompt,
      );

    res.json({
      prompt,
      source:
        prompt === sourcePrompt
          ? "fallback"
          : "director",
    });
  },
);

export default router;
