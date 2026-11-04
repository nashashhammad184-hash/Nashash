import { Router, type Request, type Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { eq, asc, and } from "drizzle-orm";
import { runDirector } from "../lib/voice/voiceDirector";
import { mergeFields, buildResolvedText } from "../lib/voice/resolveInstruction";
import { EMOTIONS, AUDAR_TAGS } from "../lib/voice/directorSchema";
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

router.post("/shots/:id/claim", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "INVALID_SHOT_ID" });
    return;
  }
  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) {
    res.status(404).json({ error: "SHOT_NOT_FOUND" });
    return;
  }
  if (shot.audioStatus === "COMPLETED") {
    res.status(409).json({ error: "ALREADY_COMPLETED" });
    return;
  }
  const now = new Date();
  const LEASE_MS = 10 * 60 * 1000;
  const isStale = !shot.audioClaimedAt || (now.getTime() - new Date(shot.audioClaimedAt).getTime()) > LEASE_MS;
  if (!isStale) {
    res.status(409).json({
      error: "ALREADY_CLAIMED",
      claimedAt: shot.audioClaimedAt,
      leaseRemainingMs: LEASE_MS - (now.getTime() - new Date(shot.audioClaimedAt).getTime())
    });
    return;
  }
  const claimToken = "claim-" + Date.now() + "-" + Math.random().toString(36).substring(2, 15);
  const [updated] = await db.update(shotsTable)
    .set({ audioClaimedAt: now, audioClaimToken: claimToken, audioStage: "none" } as any)
    .where(and(eq(shotsTable.id, id), eq(shotsTable.audioStatus, shot.audioStatus)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "CLAIM_RACE", hint: "Retry" });
    return;
  }
  res.json({ ok: true, claimedAt: now, claimToken, shot: { id: updated.id, audioStatus: updated.audioStatus } });
});

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
    const claimToken = (req.body as any).claimToken;
    if (claimToken) {
      const [currentShot] = await db.select().from(shotsTable).where(eq(shotsTable.id, params.data.id)).limit(1);
      if (!currentShot) {
        res.status(404).json({ error: "Shot not found" });
        return;
      }
      if (currentShot.audioClaimToken !== claimToken) {
        res.status(409).json({ error: "CLAIM_TOKEN_MISMATCH", message: "Claim lease expired or owned by another worker" });
        return;
      }
    }
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
      if (parsed.data.audioStatus === "PROCESSING") {
        updateData.audioClaimToken = null;
        updateData.audioClaimedAt = null;
        updateData.audioStage = "none";
      }
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


router.post("/shots/:id/release-claim", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "INVALID_SHOT_ID" });
    return;
  }
  
  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) {
    res.status(404).json({ error: "SHOT_NOT_FOUND" });
    return;
  }
  
  if (shot.audioStatus === "COMPLETED") {
    res.status(409).json({ error: "ALREADY_COMPLETED" });
    return;
  }
  
  if (shot.audioStatus === "QUEUED") {
    res.json({ ok: true, noop: true });
    return;
  }
  
  await db.update(shotsTable)
    .set({ audioStatus: "QUEUED", audioClaimedAt: null } as any)
    .where(eq(shotsTable.id, id));
    
  res.json({ ok: true, shotId: id, previousStatus: shot.audioStatus });
});

// KAYAN-13: Voice Director Endpoints

router.post("/shots/:id/analyze", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) { res.status(404).json({ error: "SHOT_NOT_FOUND" }); return; }
  if (shot.audioStatus === "PROCESSING" && !req.body?.force) {
    res.status(409).json({ error: "SHOT_PROCESSING", hint: "Audio is being generated. Use force:true to override" }); return;
  }
  if (shot.audioStatus === "COMPLETED" && !req.body?.force) {
    res.status(409).json({ error: "SHOT_COMPLETED", hint: "Use force:true to override" }); return;
  }
  if (shot.directorStatus === "processing" && !req.body?.force) {
    res.status(409).json({ error: "ALREADY_ANALYZING" }); return;
  }

  const directorClaimToken = "dclaim-" + Date.now() + "-" + Math.random().toString(36).substring(2, 15);
  await db.update(shotsTable).set({ directorStatus: "processing", directorClaimToken }).where(eq(shotsTable.id, id));
  
  const result = await runDirector(shot.description || "", shot.dialogue || "", null);
  
  if (!result.ok) {
    await db.update(shotsTable).set({ directorStatus: "failed", directorError: result.error }).where(and(eq(shotsTable.id, id), eq(shotsTable.directorClaimToken, directorClaimToken)));
    res.status(500).json({ error: "DIRECTOR_FAILED", detail: result.error }); return;
  }
  
  const merged = mergeFields(result.audio_instruction, shot.manualInstruction, shot.dialogue || "");
  const resolved = buildResolvedText(shot.dialogue || "", merged);
  
  const updated = await db.update(shotsTable).set({
    audioInstruction: result.audio_instruction,
    resolvedText: resolved,
    directorStatus: "analyzed",
    directorError: null,
    directorAnalyzedAt: new Date(),
    directorInputHash: result.audio_instruction.input_hash,
    directorClaimToken: null
  }).where(and(eq(shotsTable.id, id), eq(shotsTable.directorClaimToken, directorClaimToken))).returning();

  if (updated.length === 0) {
    res.status(409).json({ error: "CLAIM_EXPIRED", detail: "Another process took over this shot analysis" }); return;
  }
  res.json({ ok: true, audio_instruction: result.audio_instruction, resolved_text: resolved });
});

router.patch("/shots/:id/manual-instruction", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) { res.status(404).json({ error: "SHOT_NOT_FOUND" }); return; }
  
  const incoming = req.body?.fields || {};
  const current = shot.manualInstruction || { updated_at: new Date().toISOString(), fields: {} };
  
  if (incoming.emotion && !EMOTIONS.includes(incoming.emotion)) { res.status(400).json({ error: "INVALID_EMOTION" }); return; }
  if (incoming.audar_tag !== undefined && incoming.audar_tag !== null && !AUDAR_TAGS.includes(incoming.audar_tag)) { res.status(400).json({ error: "INVALID_TAG" }); return; }
  
  const newFields = { ...current.fields, ...incoming };
  const newManual = { updated_at: new Date().toISOString(), fields: newFields };
  
  const merged = mergeFields(shot.audioInstruction, newManual, shot.dialogue || "");
  const resolved = buildResolvedText(shot.dialogue || "", merged);
  
  await db.update(shotsTable).set({ manualInstruction: newManual, resolvedText: resolved }).where(eq(shotsTable.id, id));
  res.json({ ok: true, manual_instruction: newManual, resolved_text: resolved });
});

router.post("/shots/:id/restore-director", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) { res.status(404).json({ error: "SHOT_NOT_FOUND" }); return; }
  
  const merged = mergeFields(shot.audioInstruction, null, shot.dialogue || "");
  const resolved = buildResolvedText(shot.dialogue || "", merged);
  
  await db.update(shotsTable).set({ manualInstruction: null, resolvedText: resolved }).where(eq(shotsTable.id, id));
  res.json({ ok: true, resolved_text: resolved });
});

router.post("/shots/:id/preview-audio", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "INVALID_SHOT_ID" });
    return;
  }

  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, id)).limit(1);
  if (!shot) {
    res.status(404).json({ error: "SHOT_NOT_FOUND" });
    return;
  }

  const textToSpeak = shot.resolvedText || shot.dialogue;
  if (!textToSpeak || textToSpeak.trim().length === 0) {
    res.status(400).json({ error: "EMPTY_TEXT" });
    return;
  }

  const audarUrl = process.env.AUDAR_URL;
  const audarToken = process.env.AUDAR_TOKEN;

  if (!audarUrl || !audarToken) {
    res.status(500).json({ error: "AUDAR_CONFIG_MISSING" });
    return;
  }

  const tagMatch = textToSpeak.match(/^\s*\[(\w+)\]/);
  const tag = tagMatch ? tagMatch[1] : "neutral";
  const targetDuration = shot.durationSeconds || 5.0;
  const idemKey = `preview-${id}-${Date.now()}`;

  try {
    const response = await fetch(`${audarUrl}/tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${audarToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({
        text: textToSpeak,
        tag: tag,
        voice: "demo_female_1",
        target_duration_s: targetDuration,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Preview Oracle error:", errText);
      res.status(502).json({ error: "ORACLE_TTS_FAILED", detail: errText });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length.toString());
    res.send(buffer);

  } catch (error: any) {
    console.error("Preview error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", detail: error.message });
  }
});

export default router;
