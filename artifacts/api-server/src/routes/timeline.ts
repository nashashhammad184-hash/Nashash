import { Router, type Request, type Response } from "express";
import { pool, db } from "@workspace/db";
import { timelineItemsTable, shotsTable, editClipsTable } from "@workspace/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { createRenderJob, runRenderPipeline, type RenderClipInput } from "../lib/renderEngine";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router = Router();

// ---------- helpers ----------
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
function isLocalUploadPath(s: string): boolean {
  return typeof s === "string" && (s.startsWith("/uploads/") || s.startsWith("/api/storage/supabase/") || s.startsWith("/api/storage/r2/"));
}
function looksLikeRealAsset(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length === 0) return false;
  // Asset must be either a real URL or an /uploads/... path
  return isHttpUrl(t) || isLocalUploadPath(t);
}

let isTableInitialized = false;
async function ensureTimelineTable() {
  if (isTableInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timeline_items (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        shot_id INTEGER,
        clip_id INTEGER,
        asset_id TEXT,
        asset_url TEXT,
        track TEXT NOT NULL,
        start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
        duration DOUBLE PRECISION NOT NULL DEFAULT 0,
        end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
        order_index INTEGER NOT NULL DEFAULT 0,
        content TEXT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    isTableInitialized = true;
  } catch (err: any) {
    console.error("Pool table init error:", err.message);
  }
}

// 1. GET /api/projects/:id/timeline
router.get("/projects/:id/timeline", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureTimelineTable();
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "معرف المشروع غير صالح." });
      return;
    }

    const items = await db
      .select()
      .from(timelineItemsTable)
      .where(eq(timelineItemsTable.projectId, projectId))
      .orderBy(asc(timelineItemsTable.startTime), asc(timelineItemsTable.order));

    const tracks = {
      VIDEO: items.filter((i) => i.track === "VIDEO"),
      VOICE: items.filter((i) => i.track === "VOICE"),
      MUSIC: items.filter((i) => i.track === "MUSIC"),
      SFX: items.filter((i) => i.track === "SFX"),
    };

    const totalDuration = items.reduce(
      (max, item) => Math.max(max, Number(item.endTime) || (Number(item.startTime) + Number(item.duration))),
      0,
    );

    res.json({
      success: true,
      projectId,
      totalDuration,
      itemsCount: items.length,
      tracks,
      items,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /api/projects/:id/timeline/sync
//    - Rebuild timeline from shots or clips
//    - Only create VIDEO items that have a real asset URL
//    - Do NOT fabricate MUSIC / SFX placeholder rows
//    - Only enqueue a render job if there is at least one real VIDEO asset
router.post("/projects/:id/timeline/sync", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureTimelineTable();
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "معرف المشروع غير صالح." });
      return;
    }

    const shots = await db
      .select()
      .from(shotsTable)
      .where(eq(shotsTable.projectId, projectId))
      .orderBy(asc(shotsTable.id));

    const clips = await db
      .select()
      .from(editClipsTable)
      .where(eq(editClipsTable.projectId, projectId))
      .orderBy(asc(editClipsTable.clipOrder));

    console.log(`[Timeline Sync] syncing timeline for project #${projectId}`);

    // ─── KAYAN-TASK-10 — Merge strategy (no destructive delete-all by default) ───
    // Classification:
    //   metadata.origin === "manual"      → manual row: preserve entirely
    //   metadata.origin === "generated"   → generated row: update assetUrl only when needed
    //   metadata empty/null (legacy)      → treat as generated (pre-TASK-10 rows were all generated)
    const explicitReset = (req.body && (req.body as any).reset === true);
    const existingRows = explicitReset
      ? []
      : await db.select().from(timelineItemsTable).where(eq(timelineItemsTable.projectId, projectId));

    type Classified = { row: any; kind: "manual" | "generated" };
    const classified: Classified[] = [];
    for (const r of existingRows) {
      let kind: "manual" | "generated" = "generated";
      const raw = (r as any).metadata;
      if (raw && typeof raw === "string") {
        try {
          const m = JSON.parse(raw);
          if (m && m.origin === "manual") kind = "manual";
          else if (m && m.origin === "generated") kind = "generated";
        } catch { /* legacy/invalid metadata → generated */ }
      }
      classified.push({ row: r, kind });
    }

    const generatedKey = (track: string, shotId: number | null, clipId: number | null) =>
      `${track}:${shotId ?? ""}:${clipId ?? ""}`;

    const existingGenerated = new Map<string, any>();
    const manualRows: any[] = [];
    for (const c of classified) {
      if (c.kind === "manual") manualRows.push(c.row);
      else existingGenerated.set(generatedKey(c.row.track, c.row.shotId, c.row.clipId), c.row);
    }
    void manualRows;

    // If reset explicitly requested → wipe (opt-in behavior only) and rebuild fresh.
    if (explicitReset) {
      await db.delete(timelineItemsTable).where(eq(timelineItemsTable.projectId, projectId));
    }

    const upsertGenerated = async (values: any): Promise<any | null> => {
      const key = generatedKey(values.track, values.shotId ?? null, values.clipId ?? null);
      const prev = existingGenerated.get(key);
      const meta = JSON.stringify({ origin: "generated" });
      if (prev) {
        const needAsset = (prev.assetUrl ?? null) !== (values.assetUrl ?? null);
        const needContent = (prev.content ?? null) !== (values.content ?? null);
        existingGenerated.delete(key);
        if (needAsset || needContent) {
          const [u] = await db.update(timelineItemsTable)
            .set({
              ...(needAsset ? { assetUrl: values.assetUrl } : {}),
              ...(needContent ? { content: values.content } : {}),
              metadata: meta,
            })
            .where(eq(timelineItemsTable.id, prev.id))
            .returning();
          return u ?? prev;
        }
        return prev;
      }
      const [ins] = await db.insert(timelineItemsTable)
        .values({ ...values, metadata: meta })
        .returning();
      return ins;
    };

    let currentTime = 0;
    let orderCounter = 1;
    const newItems: any[] = [];
    const renderClips: RenderClipInput[] = [];

    if (shots.length > 0) {
      for (const shot of shots) {
        const shotDuration = Number(shot.durationSeconds) || 5;
        const start = currentTime;
        const end = currentTime + shotDuration;
        const shotDesc = shot.description || "Cinematic Shot";

        const videoAsset = shot.videoUrl && looksLikeRealAsset(shot.videoUrl) ? shot.videoUrl : null;

        // VIDEO item only if a real asset exists
        if (videoAsset) {
          const vItem = await upsertGenerated({
            projectId,
            shotId: shot.id,
            track: "VIDEO",
            startTime: start,
            duration: shotDuration,
            endTime: end,
            order: orderCounter++,
            content: shotDesc,
            assetUrl: videoAsset,
          });
          if (vItem) {
            newItems.push(vItem);
            renderClips.push({
              id: vItem.id,
              assetUrl: videoAsset,
              durationSeconds: shotDuration,
              order: vItem.order,
            });
          }
        } else {
          // No real video asset → record intent only, do NOT create a VIDEO row
          console.log(`⚠️  [Timeline Sync] shot #${shot.id} has no real videoUrl — skipping VIDEO track (no placeholder)`);
        }

        // VOICE item only if a real audio asset exists
        const shotDialogue = (shot.dialogue || "").trim();
        if (shotDialogue) {
          const audioAsset = shot.audioUrl && looksLikeRealAsset(shot.audioUrl) ? shot.audioUrl : null;
          const voiceItem = await upsertGenerated({
            projectId,
            shotId: shot.id,
            track: "VOICE",
            startTime: start,
            duration: shotDuration,
            endTime: end,
            order: orderCounter++,
            content: shotDialogue,
            assetUrl: audioAsset,
          });
          if (voiceItem) newItems.push(voiceItem);
        }

        // SFX: only if shotAudioNote AND a real audio asset exists.
        // We have no dedicated sfx_url column yet, so we DO NOT create SFX rows.
        // (silent placeholders are forbidden)

        currentTime = end;
      }
    } else if (clips.length > 0) {
      for (const clip of clips) {
        const clipDuration = Number(clip.durationSeconds) || 5;
        const start = currentTime;
        const end = currentTime + clipDuration;
        const track = (clip.trackType || "video").toUpperCase();

        const asset = clip.assetId && looksLikeRealAsset(clip.assetId) ? clip.assetId : null;
        // KAYAN-TASK-13 — MUSIC/SFX rows require a real asset. No provider
        // exists for MUSIC_SFX_GEN, so we NEVER fabricate a silent/placeholder
        // row. Skipped explicitly with a diagnostic.
        if ((track === "MUSIC" || track === "SFX") && !asset) {
          console.log(`[Timeline Sync] clip #${clip.id} track=${track} has no real asset — OPEN_DEPENDENCY (MUSIC_SFX_GEN unimplemented), skipping`);
          currentTime = currentTime + clipDuration;
          continue;
        }
        const cItem = await upsertGenerated({
          projectId,
          clipId: clip.id,
          track,
          startTime: start,
          duration: clipDuration,
          endTime: end,
          order: orderCounter++,
          content: clip.title,
          assetUrl: asset,
        });
        if (cItem) {
          newItems.push(cItem);
          if (track === "VIDEO" && asset) {
            renderClips.push({
              id: cItem.id,
              assetUrl: asset,
              durationSeconds: clipDuration,
              order: cItem.order,
              sourceStart: clip.sourceStart ?? 0,
              sourceEnd: clip.sourceEnd ?? clipDuration,
            });
          }
        }
        currentTime = end;
      }
    }

    const totalDuration = currentTime;

    // No real video assets → refuse to fabricate a render
    if (renderClips.length === 0) {
      res.status(409).json({
        success: false,
        error: "لا يوجد أي فيديو حقيقي (asset URL) في التايم لاين. مطلوب أصل فيديو صالح واحد على الأقل قبل الإطلاق.",
        totalDuration,
        jobId: null,
        outputVideoUrl: null,
      });
      return;
    }

    // ── Load REQUIRED real VOICE track ──
    const voiceResult: any = await db.execute(sql`
      SELECT asset_url FROM timeline_items
      WHERE project_id = ${projectId}
        AND track = 'VOICE'
        AND asset_url IS NOT NULL
      ORDER BY order_index ASC
      LIMIT 1
    `);
    const voiceRows: any[] = voiceResult?.rows ?? voiceResult ?? [];
    const audioUrl = voiceRows[0]?.asset_url;
    if (!audioUrl || !looksLikeRealAsset(audioUrl)) {
      res.status(409).json({
        success: false,
        error: "Real audio asset missing: no VOICE track with real asset URL exists in the timeline. Silent render fallback is disabled.",
        totalDuration,
        jobId: null,
        outputVideoUrl: null,
      });
      return;
    }

    const activeRenderJob = await createRenderJob({
      projectId,
      watermarkText: "Produced by Kayan AI Productions",
      subtitlesText: undefined,
      clips: renderClips,
      audioUrl,
    });

    // Kick off background execution
    setImmediate(() => { void runRenderPipeline(activeRenderJob.id); });

    res.status(201).json({
      success: true,
      status: activeRenderJob.status,
      jobId: activeRenderJob.id,
      totalDuration,
      outputVideoUrl: activeRenderJob.outputUrl,
    });
  } catch (err: any) {
    res.status(500).json({ error: "فشل مزامنة التايم لاين: " + err.message });
  }
});

export default router;
