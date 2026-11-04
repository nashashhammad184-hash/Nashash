import { Router, type Request, type Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { db, audioLibraryAssetsTable, shotAudioAssetsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

// GET /api/audio-library?type=music
router.get("/audio-library", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const type = req.query.type ? String(req.query.type) : null;
    let query = db.select().from(audioLibraryAssetsTable);
    if (type) query = query.where(eq(audioLibraryAssetsTable.assetType, type)) as any;
    const assets = await query.orderBy(desc(audioLibraryAssetsTable.createdAt));
    res.json({ ok: true, assets });
  } catch (error: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", detail: error.message });
  }
});

// GET /api/shots/:id/audio-assets
router.get("/shots/:id/audio-assets", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  try {
    const assets = await db.select().from(shotAudioAssetsTable).where(eq(shotAudioAssetsTable.shotId, id)).orderBy(shotAudioAssetsTable.trackOrder);
    res.json({ ok: true, assets });
  } catch (error: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", detail: error.message });
  }
});

// POST /api/shots/:id/audio-assets
router.post("/shots/:id/audio-assets", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { asset_type, audio_url, start_time, end_time, volume, fade_in, fade_out, status, source } = req.body;
  try {
    const [asset] = await db.insert(shotAudioAssetsTable).values({
      shotId: id,
      assetType: asset_type,
      audioUrl: audio_url,
      startTime: start_time ?? 0,
      endTime: end_time ?? 5,
      volume: volume ?? 1.0,
      fadeIn: fade_in ?? 0,
      fadeOut: fade_out ?? 0,
      status: status ?? "approved",
      source: source ?? "manual"
    }).returning();
    res.status(201).json({ ok: true, asset });
  } catch (error: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", detail: error.message });
  }
});

export default router;
