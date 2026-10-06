/**
 * KAYAN-TASK-26 — shared subtitle synchronization service.
 *
 * Extracted from POST /api/projects/:id/subtitles/sync so it can be called
 * directly by ScriptJobRunner (auto-run after script stage) without an HTTP hop.
 *
 * Behavior preserved from the original route:
 *  - ensures subtitles table exists
 *  - loads all shots for the project (ordered by id)
 *  - rebuilds subtitles from shots.dialogue + shots.durationSeconds
 *  - if no dialogue shots exist, emits a single default header row (existing behavior)
 *  - returns the inserted rows + generated SRT/VTT previews
 *
 * Note on manual edits: the subtitles table has no origin/manual classification
 * column. Sync replaces all rows for the project. This matches the existing
 * route behavior — no new classification was introduced by this task.
 */
import { pool } from "@workspace/db";
import {
  generateSRT,
  generateVTT,
  validateSubtitleTiming,
  type SubtitleItem,
} from "../subtitleService";
import { logger } from "../logger";

export interface SubtitleSyncResult {
  projectId: number;
  count: number;
  subtitles: SubtitleItem[];
  previewSRT: string;
  previewVTT: string;
}

async function ensureSubtitlesTable(): Promise<void> {
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

export async function syncProjectSubtitles(projectId: number): Promise<SubtitleSyncResult> {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error(`syncProjectSubtitles: invalid projectId=${projectId}`);
  }
  await ensureSubtitlesTable();

  let shots: any[] = [];
  try {
    const shotsRes = await pool.query(
      "SELECT * FROM shots WHERE project_id = $1 ORDER BY id ASC",
      [projectId],
    );
    shots = shotsRes.rows || [];
  } catch (e: any) {
    logger.warn({ err: e, projectId }, "subtitleSync: could not load shots");
    shots = [];
  }

  // Rebuild subtitles from source-of-truth shots (idempotent replacement).
  await pool.query("DELETE FROM subtitles WHERE project_id = $1", [projectId]);

  let currentTime = 0;
  let orderIndex = 1;
  const inserted: SubtitleItem[] = [];

  for (const shot of shots) {
    const duration = Number(shot.duration_seconds || shot.duration) || 5;
    const start = currentTime;
    const end = currentTime + duration;
    const dialogue = (shot.dialogue || shot.audio_cue || "").trim();
    if (dialogue && validateSubtitleTiming(start, end)) {
      const resInsert = await pool.query(
        `INSERT INTO subtitles (project_id, shot_id, text, start_time, end_time, order_index, language)
         VALUES ($1, $2, $3, $4, $5, $6, 'ar')
         RETURNING id, order_index, start_time, end_time, text, language`,
        [projectId, shot.id, dialogue, start, end, orderIndex++],
      );
      if (resInsert.rows[0]) {
        const row = resInsert.rows[0];
        inserted.push({
          id: row.id,
          orderIndex: Number(row.order_index),
          startTime: Number(row.start_time),
          endTime: Number(row.end_time),
          text: String(row.text),
          language: row.language,
        });
      }
    }
    currentTime = end;
  }

  if (inserted.length === 0) {
    // Existing behavior: single default header row when no dialogue shots exist.
    const defaultText = "المشهد الأول: بداية الرحلة السينمائية";
    const resDef = await pool.query(
      `INSERT INTO subtitles (project_id, text, start_time, end_time, order_index, language)
       VALUES ($1, $2, 0, 5, $3, 'ar')
       RETURNING id, order_index, start_time, end_time, text, language`,
      [projectId, defaultText, orderIndex++],
    );
    if (resDef.rows[0]) {
      const row = resDef.rows[0];
      inserted.push({
        id: row.id,
        orderIndex: Number(row.order_index),
        startTime: Number(row.start_time),
        endTime: Number(row.end_time),
        text: String(row.text),
        language: row.language,
      });
    }
  }

  const previewSRT = generateSRT(inserted);
  const previewVTT = generateVTT(inserted);
  return {
    projectId,
    count: inserted.length,
    subtitles: inserted,
    previewSRT,
    previewVTT,
  };
}
