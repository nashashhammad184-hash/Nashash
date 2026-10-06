import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { generateSRT, generateVTT, validateSubtitleTiming, type SubtitleItem } from "../lib/subtitleService";
import { syncProjectSubtitles } from "../lib/services/subtitleSyncService";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router: IRouter = Router();

async function ensureSubtitlesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subtitles (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER,
      text TEXT NOT NULL,
      start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'ar',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

// 1. GET /api/projects/:id/subtitles - جلب ملفات الترجمة المخزنة للمشروع الصحيح
router.get("/projects/:id/subtitles", async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureSubtitlesTable();
    const projectId = Number(req.params.id);
    const query = await pool.query(
      "SELECT * FROM subtitles WHERE project_id = $1 ORDER BY start_time ASC, order_index ASC",
      [projectId]
    );
    res.json({
      success: true,
      projectId,
      count: query.rowCount,
      subtitles: query.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /api/projects/:id/subtitles/sync - المزامنة الحقيقية واستخراج النصوص من الـ DB وصياغة ملفات التوقيت
router.post("/projects/:id/subtitles/sync", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = Number(req.params.id);
    // KAYAN-TASK-26: shared service used by both this endpoint and
    // ScriptJobRunner auto-sync. No logic duplication.
    const result = await syncProjectSubtitles(projectId);
    res.status(201).json({
      success: true,
      message: "Subtitles synchronized in DB successfully",
      projectId,
      count: result.count,
      subtitles: result.subtitles,
      previewSRT: result.previewSRT,
      previewVTT: result.previewVTT,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/projects/:id/subtitles/export - تصدير وتحميل حقيقي (SRT/VTT Export Control) إلى جهاز المخرج مستقیم
router.get("/projects/:id/subtitles/export", async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureSubtitlesTable();
    const projectId = Number(req.params.id);
    const format = String(req.query.format || "srt").toLowerCase();
    
    const query = await pool.query(
      "SELECT * FROM subtitles WHERE project_id = $1 ORDER BY start_time ASC, order_index ASC",
      [projectId]
    );
    
    const items: SubtitleItem[] = query.rows.map((row: any) => ({
      orderIndex: Number(row.order_index),
      startTime: Number(row.start_time),
      endTime: Number(row.end_time),
      text: String(row.text),
      language: row.language,
    }));
    
    if (format === "vtt") {
      const vtt = generateVTT(items);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="project_${projectId}.vtt"`);
      res.send(vtt);
    } else {
      const srt = generateSRT(items);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="project_${projectId}.srt"`);
      res.send(srt);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
