import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { generateSRT, generateVTT, validateSubtitleTiming, type SubtitleItem } from "../lib/subtitleService";

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
router.post("/projects/:id/subtitles/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureSubtitlesTable();
    const projectId = Number(req.params.id);
    let shots: any[] = [];
    try {
      const shotsRes = await pool.query("SELECT * FROM shots WHERE project_id = $1 ORDER BY id ASC", [projectId]);
      shots = shotsRes.rows || [];
    } catch {
      shots = [];
    }
    
    // تنظيف خط الترجمة القديم للمشروع الحالي لمنع تراكم النصوص القديمة
    await pool.query("DELETE FROM subtitles WHERE project_id = $1", [projectId]);
    
    let currentTime = 0;
    let orderIndex = 1;
    const inserted: SubtitleItem[] = [];
    
    if (shots.length > 0) {
      for (const shot of shots) {
        const duration = Number(shot.duration_seconds || shot.duration) || 5;
        const start = currentTime;
        const end = currentTime + duration;
        const dialogue = (shot.dialogue || shot.audio_cue || "").trim();
        
        if (dialogue && validateSubtitleTiming(start, end)) {
          const resInsert = await pool.query(
            `INSERT INTO subtitles (project_id, shot_id, text, start_time, end_time, order_index, language)
             VALUES ($1, $2, $3, $4, $5, $6, 'ar') RETURNING id, order_index, start_time, end_time, text, language`,
            [projectId, shot.id, dialogue, start, end, orderIndex++]
          );
          
          if (resInsert.rows[0]) {
            const row = resInsert.rows[0];
            inserted.push({
              id: row.id,
              orderIndex: Number(row.order_index),
              startTime: Number(row.start_time),
              endTime: Number(row.end_time),
              text: String(row.text),
              language: row.language
            });
          }
        }
        currentTime = end;
      }
    }
    
    // في حال عدم وجود لقطات حوارية، نزرع ترويسة البداية تلقائياً لمنع التصدير الفارغ
    if (inserted.length === 0) {
      const defaultText = "المشهد الأول: بداية الرحلة السينمائية";
      const resDef = await pool.query(
        `INSERT INTO subtitles (project_id, text, start_time, end_time, order_index, language)
         VALUES ($1, $2, 0, 5, $3, 'ar') RETURNING id, order_index, start_time, end_time, text, language`,
        [projectId, defaultText, orderIndex++]
      );
      if (resDef.rows[0]) {
        const row = resDef.rows[0];
        inserted.push({
          id: row.id,
          orderIndex: Number(row.order_index),
          startTime: Number(row.start_time),
          endTime: Number(row.end_time),
          text: String(row.text),
          language: row.language
        });
      }
    }
    
    const srtContent = generateSRT(inserted);
    const vttContent = generateVTT(inserted);
    
    res.status(201).json({
      success: true,
      message: "Subtitles synchronized in DB successfully",
      projectId,
      count: inserted.length,
      subtitles: inserted,
      previewSRT: srtContent,
      previewVTT: vttContent,
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
