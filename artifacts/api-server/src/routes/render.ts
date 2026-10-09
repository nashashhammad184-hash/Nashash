import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, renderJobsTable } from "@workspace/db";
import { createRenderJob, getRenderJobStatus, runRenderPipeline, type RenderClipInput } from "../lib/renderEngine";
import { generateSRT, type SubtitleItem } from "../lib/subtitleService";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router: IRouter = Router();

function looksLikeRealAsset(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length === 0) return false;
  return /^https?:\/\//i.test(t) || t.startsWith("/uploads/");
}

// KAYAN-TASK-48: load synchronized subtitles for a project. Returns
// undefined when no real subtitle rows exist -> no fake burn-in.
async function loadSubtitlesSRT(projectId: number): Promise<string | undefined> {
  try {
    const result: any = await db.execute(sql`
      SELECT text, start_time, end_time, order_index, language
      FROM subtitles
      WHERE project_id = ${projectId}
      ORDER BY start_time ASC, order_index ASC
    `);
    const rows: any[] = result?.rows ?? result ?? [];
    const items: SubtitleItem[] = [];
    for (const r of rows) {
      const text = String(r.text ?? "").trim();
      if (!text) continue;
      const startTime = Number(r.start_time);
      const endTime = Number(r.end_time);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) continue;
      items.push({
        orderIndex: Number(r.order_index) || 0,
        startTime,
        endTime,
        text,
        language: typeof r.language === "string" ? r.language : "ar",
      });
    }
    if (items.length === 0) return undefined;
    const srt = generateSRT(items);
    if (!srt || srt.trim().length === 0) return undefined;
    return srt;
  } catch {
    return undefined;
  }
}

// 1. POST /api/render/projects/:id/render/start
//    Loads REAL clip assets from timeline_items (VIDEO track only) and enqueues a render.
router.post("/projects/:id/render/start", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = Number(String(req.params.id));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  try {
    // Pull VIDEO rows from timeline_items that have a real assetUrl
    const rowsResult: any = await db.execute(sql`
      SELECT id, asset_url, duration, order_index
      FROM timeline_items
      WHERE project_id = ${projectId}
        AND track = 'VIDEO'
      ORDER BY order_index ASC
    `);

    const raw: any[] = rowsResult?.rows ?? rowsResult ?? [];
    const clips: RenderClipInput[] = [];
    for (const r of raw) {
      if (!looksLikeRealAsset(r.asset_url)) continue;
      clips.push({
        id: r.id,
        assetUrl: r.asset_url,
        durationSeconds: Number(r.duration) || 5,
        order: Number(r.order_index) || 0,
      });
    }

    if (clips.length === 0) {
      res.status(409).json({
        success: false,
        error: "لا يوجد أي فيديو حقيقي مرتبط بمسار VIDEO. زامن التايم لاين أولاً مع أصول فيديو صالحة.",
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
      });
      return;
    }

    // KAYAN-TASK-48: burn synchronized subtitles when they exist.
    const subtitlesText = await loadSubtitlesSRT(projectId);
    const job = await createRenderJob({
      projectId,
      watermarkText: "PRODUCED BY KAYAN AI PRODUCTIONS",
      subtitlesText,
      clips,
      audioUrl,
    });

    // Kick off background execution
    setImmediate(() => { void runRenderPipeline(job.id); });

    res.status(201).json({
      success: true,
      jobId: job.id,
      status: job.status,
      subtitlesBurnedIn: typeof subtitlesText === "string",
      message: "Render job queued",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET render job status — reads from DB
router.get(["/status/:id", "/render/status/:id"], async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params.id);
  try {
    const job = await getRenderJobStatus(jobId);
    if (!job) {
      res.status(404).json({ error: "Render job not found" });
      return;
    }
    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      outputUrl: job.outputUrl,
      outputPath: job.outputPath,
      duration: job.duration,
      sizeBytes: job.sizeBytes,
      error: job.error,
      createdAt: job.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET latest render jobs for a project
router.get("/projects/:id/render/jobs", async (req: Request, res: Response): Promise<void> => {
  const projectId = Number(String(req.params.id));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(renderJobsTable)
      .where(eq(renderJobsTable.projectId, projectId))
      .orderBy(desc(renderJobsTable.createdAt))
      .limit(20);

    res.json({
      success: true,
      projectId,
      jobs: rows.map((r) => ({
        id: r.id,
        status: r.status,
        outputUrl: r.outputUrl,
        outputPath: r.outputPath,
        duration: r.duration,
        sizeBytes: r.sizeBytes,
        error: r.error,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
