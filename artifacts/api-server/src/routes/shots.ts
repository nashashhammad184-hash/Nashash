import { Router, type Request, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import {
  ListProjectShotsParams, ListProjectShotsResponse,
  CreateShotBody, CreateShotResponse,
  UpdateShotParams, UpdateShotBody, UpdateShotResponse,
  DeleteShotParams
} from "@workspace/api-zod";

const router = Router();

// 1. GET /api/projects/:id/shots - جلب اللقطات السينمائية للمشروع الصحيح
router.get("/projects/:id/shots", async (req: Request, res: Response): Promise<void> => {
  const params = ListProjectShotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const shots = await db
      .select()
      .from(shotsTable)
      .where(eq(shotsTable.projectId, params.data.id))
      .orderBy(asc(shotsTable.sceneNumber), asc(shotsTable.id));
      
    res.json(shots);
  } catch (err: any) {
    res.status(500).json({ error: "فشل جلب اللقطات: " + err.message });
  }
});

// 2. POST /api/shots - إنشاء لقطة إخراجية جديدة حقيقية داخل PostgreSQL
router.post("/shots", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateShotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [shot] = await db.insert(shotsTable).values({
      projectId: parsed.data.projectId,
      scriptId: parsed.data.scriptId ?? null,
      sceneNumber: String(parsed.data.sceneNumber),
      description: parsed.data.description.trim(),
      cameraMovement: parsed.data.cameraMovement,
      durationSeconds: parsed.data.durationSeconds ?? 5,
      dialogue: parsed.data.dialogue ? parsed.data.dialogue.trim() : null,
      audioNote: parsed.data.audioNote ? parsed.data.audioNote.trim() : null,
      audioStatus: "QUEUED"
    }).returning();
    
    res.status(201).json(shot);
  } catch (err: any) {
    res.status(500).json({ error: "فشل إدخال اللقطة في PostgreSQL: " + err.message });
  }
});

// 3. POST /api/shots/bulk-update - المزامنة الكتلية للتايم لاين
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
  } catch (error: any) {
    res.status(500).json({ error: "Failed to perform timeline bulk sync", message: error.message });
  }
});

// 4. PATCH /api/shots/:id - تعديل لقطة حقيقية
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
  try {
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
    res.json(shot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/shots/:id - الحذف النهائي للقطة الإخراجية
router.delete("/shots/:id", async (req: Request, res: Response): Promise<void> => {
  const params = DeleteShotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const [shot] = await db
      .delete(shotsTable)
      .where(eq(shotsTable.id, params.data.id))
      .returning();
      
    if (!shot) {
      res.status(404).json({ error: "Shot not found" });
      return;
    }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
