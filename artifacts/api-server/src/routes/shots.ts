import { Router, type IRouter, type Request, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import {
  ListProjectShotsParams,
  ListProjectShotsResponse,
  CreateShotBody,
  CreateShotResponse,
  UpdateShotParams,
  UpdateShotBody,
  UpdateShotResponse,
  DeleteShotParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// List shots for a project
router.get("/projects/:id/shots", async (req: Request, res: Response): Promise<void> => {
  const params = ListProjectShotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const shots = await db
    .select()
    .from(shotsTable)
    .where(eq(shotsTable.projectId, params.data.id))
    .orderBy(asc(shotsTable.sceneNumber));
  
  res.json(
    ListProjectShotsResponse.parse(
      shots.map((s) => ({
        ...s,
        scriptId: s.scriptId ?? null,
        dialogue: s.dialogue ?? null,
        audioNote: s.audioNote ?? null,
        createdAt: s.createdAt.toISOString(),
      }))
    )
  );
});

// Create shot
router.post("/shots", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateShotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shot] = await db.insert(shotsTable).values({
    projectId: parsed.data.projectId,
    scriptId: parsed.data.scriptId ?? null,
    sceneNumber: String(parsed.data.sceneNumber),
    description: parsed.data.description,
    cameraMovement: parsed.data.cameraMovement,
    durationSeconds: parsed.data.durationSeconds ?? 5,
    dialogue: parsed.data.dialogue ?? null,
    audioNote: parsed.data.audioNote ?? null,
  }).returning();

  res.status(201).json(
    CreateShotResponse.parse({
      ...shot,
      scriptId: shot.scriptId ?? null,
      dialogue: shot.dialogue ?? null,
      audioNote: shot.audioNote ?? null,
      createdAt: shot.createdAt.toISOString(),
    })
  );
});

// Bulk update shots for Timeline Sync
router.post("/shots/bulk-update", async (req: Request, res: Response): Promise<void> => {
  const { shots } = req.body || {};
  if (!Array.isArray(shots)) {
    res.status(400).json({ error: "Invalid payload: shots array is required" });
    return;
  }
  try {
    for (const s of shots) {
      if (!s.id) continue;
      const updateData: Record<string, any> = {};
      if (s.durationSeconds !== undefined) updateData.durationSeconds = s.durationSeconds;
      if (s.sceneNumber !== undefined) updateData.sceneNumber = String(s.sceneNumber);
      if (s.description !== undefined) updateData.description = s.description;
      
      await db.update(shotsTable).set(updateData).where(eq(shotsTable.id, s.id));
    }
    res.json({ success: true, message: "Timeline shots synced successfully in database" });
  } catch (error) {
    res.status(500).json({ error: "Failed to perform timeline bulk sync", message: String(error) });
  }
});

// Update shot
router.patch("/shots/:id", async (req: Request, res: Response): Promise<void> => {
  const params = UpdateShotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateShotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, any> = {};
  if (parsed.data.sceneNumber !== undefined) updateData.sceneNumber = String(parsed.data.sceneNumber);
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.cameraMovement !== undefined) updateData.cameraMovement = parsed.data.cameraMovement;
  if (parsed.data.durationSeconds !== undefined) updateData.durationSeconds = parsed.data.durationSeconds;
  if (parsed.data.dialogue !== undefined) updateData.dialogue = parsed.data.dialogue ?? null;
  if (parsed.data.audioNote !== undefined) updateData.audioNote = parsed.data.audioNote ?? null;

  const [shot] = await db
    .update(shotsTable)
    .set(updateData)
    .where(eq(shotsTable.id, params.data.id))
    .returning();

  if (!shot) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }
  res.json(
    UpdateShotResponse.parse({
      ...shot,
      scriptId: shot.scriptId ?? null,
      dialogue: shot.dialogue ?? null,
      audioNote: shot.audioNote ?? null,
      createdAt: shot.createdAt.toISOString(),
    })
  );
});

// Delete shot
router.delete("/shots/:id", async (req: Request, res: Response): Promise<void> => {
  const params = DeleteShotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [shot] = await db
    .delete(shotsTable)
    .where(eq(shotsTable.id, params.data.id))
    .returning();

  if (!shot) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
