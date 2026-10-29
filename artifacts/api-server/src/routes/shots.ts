import { Router, type Request, type Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { eq, asc, and } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import {
  ListProjectShotsParams, ListProjectShotsResponse,
  CreateShotBody, CreateShotResponse,
  UpdateShotParams, UpdateShotBody, UpdateShotResponse,
  DeleteShotParams
} from "@workspace/api-zod";

const router = Router();

// KAYAN-8: URL validation for shots.videoUrl / shots.audioUrl.
// Single source of truth (no OpenAPI pattern — Orval ignores it).
// Allowed: null (clear), /uploads/*, /api/storage/*. Rejects data: and https:// external.
export function isValidStorageUrl(url: string | null | undefined): boolean {
  if (url === null || url === undefined) return true;
  if (typeof url !== "string") return false;
  return url.startsWith("/uploads/") || url.startsWith("/api/storage/");
}

// 1. GET /api/projects/:id/shots - جلب اللقطات السينمائية للمشروع الصحيح
router.get("/projects/:id/shots", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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
    console.error("[route] internal error", err?.message || err);
    res.status(500).json({ error: "INTERNAL_ERROR", code: "REQUEST_FAILED" });
  }
});

// 2. POST /api/shots - إنشاء لقطة إخراجية جديدة حقيقية داخل PostgreSQL
router.post("/shots", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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
    console.error("[route] internal error", err?.message || err);
    res.status(500).json({ error: "INTERNAL_ERROR", code: "REQUEST_FAILED" });
  }
});

// 3. POST /api/shots/bulk-update - المزامنة الكتلية للتايم لاين
router.post("/shots/bulk-update", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const { shots, projectId } = req.body || {};
  if (!Array.isArray(shots)) {
    res.status(400).json({ error: "Invalid payload: shots array is required" });
    return;
  }
  // KAYAN-SECURITY-21: bulk updates MUST be scoped to a single project.
  // Without this, an authenticated caller could modify shots belonging to
  // any project by guessing IDs. The DB WHERE clause enforces the scope
  // (not just the request body check).
  const projectIdNum = Number(projectId);
  if (!Number.isInteger(projectIdNum) || projectIdNum <= 0) {
    res.status(400).json({ error: "Invalid payload: integer projectId is required" });
    return;
  }
  try {
    for (const s of shots) {
      if (!s.id) continue;
      const updateData: Record<string, any> = {};
      if (s.durationSeconds !== undefined) updateData.durationSeconds = s.durationSeconds;
      if (s.sceneNumber !== undefined) updateData.sceneNumber = String(s.sceneNumber);
      if (s.description !== undefined) updateData.description = s.description;
      await db.update(shotsTable).set(updateData).where(and(eq(shotsTable.id, s.id), eq(shotsTable.projectId, projectIdNum)));
    }
    res.json({ success: true, message: "Timeline shots synced successfully in database" });
  } catch (error: any) {
    console.error("[route] internal error", error?.message || error);
    res.status(500).json({ error: "INTERNAL_ERROR", code: "BULK_SYNC_FAILED" });
  }
});

// 4. PATCH /api/shots/:id - تعديل لقطة حقيقية
router.patch("/shots/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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

    // KAYAN-8: PATCH handler — validate + apply storage URLs and audioStatus.
    if (parsed.data.videoUrl !== undefined) {
      if (!isValidStorageUrl(parsed.data.videoUrl)) {
        res.status(400).json({ error: "INVALID_URL", field: "videoUrl", message: "videoUrl must be null, /uploads/*, or /api/storage/*" });
        return;
      }
      updateData.videoUrl = parsed.data.videoUrl;
    }
    if (parsed.data.audioUrl !== undefined) {
      if (!isValidStorageUrl(parsed.data.audioUrl)) {
        res.status(400).json({ error: "INVALID_URL", field: "audioUrl", message: "audioUrl must be null, /uploads/*, or /api/storage/*" });
        return;
      }
      updateData.audioUrl = parsed.data.audioUrl;
    }
    if (parsed.data.audioStatus !== undefined) {
      updateData.audioStatus = parsed.data.audioStatus;
    }
    // KAYAN-8: soft warning — audioUrl set but audioStatus not COMPLETED.
    // Not a hard error: pipeline may set FAILED with an audioUrl (recovery scenarios).
    const willHaveAudioUrl = parsed.data.audioUrl !== undefined ? parsed.data.audioUrl : null;
    const willHaveStatus = parsed.data.audioStatus !== undefined ? parsed.data.audioStatus : null;
    if (willHaveAudioUrl !== null && willHaveStatus !== null && willHaveStatus !== "COMPLETED") {
      console.warn("[shots PATCH] audioUrl set but audioStatus=" + willHaveStatus + " (expected COMPLETED) — allowed (recovery scenario)");
    }

    // KAYAN-8: reject empty updates (no fields to change → 400, not silent 200).
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "NO_FIELDS_TO_UPDATE", message: "Request body contains no updatable fields" });
      return;
    }

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
    console.error("[route] internal error", err?.message || err);
    res.status(500).json({ error: "INTERNAL_ERROR", code: "REQUEST_FAILED" });
  }
});

// 5. DELETE /api/shots/:id - الحذف النهائي للقطة الإخراجية
router.delete("/shots/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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
    console.error("[route] internal error", err?.message || err);
    res.status(500).json({ error: "INTERNAL_ERROR", code: "REQUEST_FAILED" });
  }
});

export default router;
