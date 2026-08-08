import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, scriptsTable } from "@workspace/db";
import {
  ListProjectScriptsParams,
  ListProjectScriptsResponse,
  GenerateScriptBody,
  GenerateScriptResponse,
} from "@workspace/api-zod";
import { generateCinematicScript } from "../lib/scriptGenerator";
import { asc } from "drizzle-orm";
import { shotsTable } from "@workspace/db";

const router: IRouter = Router();

// List scripts for a project
router.get("/projects/:id/scripts", async (req, res): Promise<void> => {
  const params = ListProjectScriptsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const scripts = await db
    .select()
    .from(scriptsTable)
    .where(eq(scriptsTable.projectId, params.data.id))
    .orderBy(desc(scriptsTable.createdAt));
  res.json(
    ListProjectScriptsResponse.parse(
      scripts.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      }))
    )
  );
});

// Generate a script
router.post("/scripts/generate", async (req, res): Promise<void> => {
  const parsed = GenerateScriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, idea, worldId, actors } = parsed.data;

  const generatedContent = generateCinematicScript({
    idea,
    worldId,
    actors: actors ?? [],
  });

  const [script] = await db
    .insert(scriptsTable)
    .values({ projectId, idea, worldId, generatedContent })
    .returning();

  res.status(201).json(
    GenerateScriptResponse.parse({
      ...script,
      createdAt: script.createdAt.toISOString(),
    })
  );
});

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
    .map((shot) => [
      `Scene ${shot.sceneNumber}`,
      `Visual: ${shot.description}`,
      `Camera: ${shot.cameraMovement}`,
      shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
      `Duration: ${shot.durationSeconds ?? 5} seconds`,
    ].filter(Boolean).join(". "))
    .join("\n");
}

async function translateProductionPrompt(prompt: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"]?.trim();
  if (!apiKey) return prompt;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env["GROQ_MODEL"]?.trim() || "llama-3.1-8b-instant",
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: "Translate the production prompt to concise cinematic English. Preserve scene order, dialogue meaning, camera movement, and durations. Return only the prompt.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) return prompt;
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() || prompt;
}

router.get("/projects/:id/production-prompt", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "A valid project id is required." });
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
    res.json({ prompt: "", source: "fallback" });
    return;
  }

  const sourcePrompt = fallbackProductionPrompt(shots);
  const prompt = await translateProductionPrompt(sourcePrompt);
  res.json({ prompt, source: prompt === sourcePrompt ? "fallback" : "director" });
});

export default router;
