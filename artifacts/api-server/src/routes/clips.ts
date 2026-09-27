import { Router, type Request, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import { db, editClipsTable } from "@workspace/db";
import {
  ListProjectClipsParams,
  CreateClipBody,
} from "@workspace/api-zod";

const router = Router();

function isRealAssetReference(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length === 0) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.startsWith("/uploads/")) return true;
  return false;
}

// 1. GET /api/projects/:id/clips
router.get("/projects/:id/clips", async (req: Request, res: Response): Promise<void> => {
  const params = ListProjectClipsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const clips = await db
      .select()
      .from(editClipsTable)
      .where(eq(editClipsTable.projectId, params.data.id))
      .orderBy(asc(editClipsTable.clipOrder));
    res.json(clips);
  } catch (err: any) {
    res.status(500).json({ error: "فشل جلب مسارات التايم لاين: " + err.message });
  }
});

// 2. POST /api/clips
//    - assetId is optional, but if provided it MUST be a real URL or /uploads path.
//    - We no longer auto-generate `asset_${Date.now()}` placeholder ids.
router.post("/clips", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateClipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;

  try {
    const rawAssetId = typeof d.assetId === "string" ? d.assetId.trim() : "";
    let assetId: string | null = null;
    if (rawAssetId.length > 0) {
      if (!isRealAssetReference(rawAssetId)) {
        res.status(400).json({
          error:
            "assetId يجب أن يكون رابطاً حقيقياً (http/https) أو مسار /uploads/ صالح. لا يُسمح بـ placeholder IDs مثل asset_<timestamp>.",
        });
        return;
      }
      assetId = rawAssetId;
    }

    const trackType = (d.trackType || "video").toLowerCase();
    const dur = Number(d.durationSeconds) || 5;
    const startTime = Number.isFinite(d.startTime as any) ? Number(d.startTime) : 0;
    const endTime = Number.isFinite(d.endTime as any) ? Number(d.endTime) : dur;
    const sourceStart = Number.isFinite(d.sourceStart as any) ? Number(d.sourceStart) : 0;
    const sourceEnd = Number.isFinite(d.sourceEnd as any) ? Number(d.sourceEnd) : dur;
    const volume = Number.isFinite(d.volume as any) ? Number(d.volume) : 1.0;

    console.log(`⚡ [clips] inserting clip for project #${d.projectId} on track [${trackType}] assetId=${assetId ?? "(none)"}`);

    const [clip] = await db
      .insert(editClipsTable)
      .values({
        projectId: d.projectId,
        title: d.title.trim(),
        durationSeconds: dur,
        notes: d.notes ? d.notes.trim() : null,
        clipOrder: d.clipOrder ?? 0,
        trackType,
        startTime,
        endTime,
        sourceStart,
        sourceEnd,
        volume,
        assetId,
      })
      .returning();

    res.status(201).json(clip);
  } catch (err: any) {
    res.status(500).json({ error: "فشل حفظ مقطع التايم لاين داخل قاعدة البيانات: " + err.message });
  }
});

// 3. PATCH /api/clips/:id
router.patch("/clips/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(String(req.params.id), 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "معرف المقطع غير صالح." });
    return;
  }
  try {
    const { title, durationSeconds, notes, clipOrder, trackType, startTime, endTime, volume, assetId } = req.body || {};
    const updateData: Record<string, any> = {};

    if (title !== undefined) updateData.title = String(title).trim();
    if (durationSeconds !== undefined) updateData.durationSeconds = parseInt(String(durationSeconds), 10);
    if (notes !== undefined) updateData.notes = String(notes).trim();
    if (clipOrder !== undefined) updateData.clipOrder = parseInt(String(clipOrder), 10);
    if (trackType !== undefined) updateData.trackType = String(trackType).toLowerCase();
    if (startTime !== undefined) updateData.startTime = parseFloat(String(startTime));
    if (endTime !== undefined) updateData.endTime = parseFloat(String(endTime));
    if (volume !== undefined) updateData.volume = parseFloat(String(volume));

    if (assetId !== undefined) {
      const a = String(assetId || "").trim();
      if (a.length === 0) {
        updateData.assetId = null;
      } else if (!isRealAssetReference(a)) {
        res.status(400).json({
          error:
            "assetId يجب أن يكون رابطاً حقيقياً (http/https) أو مسار /uploads/ صالح.",
        });
        return;
      } else {
        updateData.assetId = a;
      }
    }

    const [clip] = await db
      .update(editClipsTable)
      .set(updateData)
      .where(eq(editClipsTable.id, numericId))
      .returning();

    if (!clip) {
      res.status(404).json({ error: "المقطع المونتاجي غير موجود في قاعدة البيانات." });
      return;
    }
    res.json(clip);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. DELETE /api/clips/:id
router.delete("/clips/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(String(req.params.id), 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "معرف غير صالح." });
    return;
  }
  try {
    const [clip] = await db
      .delete(editClipsTable)
      .where(eq(editClipsTable.id, numericId))
      .returning();

    if (!clip) {
      res.status(404).json({ error: "المقطع غير موجود لحذفه." });
      return;
    }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
