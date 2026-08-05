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

export default router;
