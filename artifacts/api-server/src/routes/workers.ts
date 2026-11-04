import { Router, type Request, type Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { db, workerHeartbeatsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

router.post("/workers/heartbeat", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const name = String((req.body && req.body.name) || "").trim();
  if (!name || name.length > 64) {
    res.status(400).json({ error: "INVALID_WORKER_NAME" });
    return;
  }
  
  const now = new Date();
  let metadata = "{}";
  if (req.body && typeof req.body.metadata === "string") {
    metadata = req.body.metadata.slice(0, 512);
  } else if (req.body && req.body.metadata) {
    metadata = JSON.stringify(req.body.metadata).slice(0, 512);
  }
  
  try {
    await db.insert(workerHeartbeatsTable)
      .values({ name, lastSeenAt: now, metadata })
      .onConflictDoUpdate({
        target: workerHeartbeatsTable.name,
        set: { lastSeenAt: now, metadata }
      });
    res.json({ ok: true, name, lastSeenAt: now });
  } catch (e: any) {
    console.error("heartbeat failed", e);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});


router.get("/worker/audio-queue", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const limitRaw = parseInt(String(req.query.limit || "10"), 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 10;
  const lang = String(req.query.lang || "all").toLowerCase();
  
  try {
    let query = sql`
      SELECT 
        id AS "shotId",
        project_id AS "projectId",
        dialogue,
        description,
        duration_seconds AS "durationSeconds",
        audio_status AS "audioStatus",
        audio_claimed_at AS "audioClaimedAt",
        resolved_text AS "resolvedText",
        audio_instruction AS "audioInstruction",
        manual_instruction AS "manualInstruction",
        director_input_hash AS "directorInputHash"
      FROM shots
      WHERE audio_status = 'QUEUED'
        AND dialogue IS NOT NULL
        AND TRIM(dialogue) != ''
        AND (audio_claimed_at IS NULL OR audio_claimed_at < NOW() - INTERVAL '10 minutes')
    `;
    
    if (lang === "ar") {
      query = sql`${query} AND dialogue ~ '[\u0600-\u06FF]'`;
    } else if (lang === "en") {
      query = sql`${query} AND dialogue !~ '[\u0600-\u06FF]'`;
    }
    
    query = sql`${query} 
      ORDER BY 
        CASE WHEN dialogue ~ '[\u0600-\u06FF]' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT ${limit}
    `;
    
    const result = await db.execute(query);
    const shots = (result as any).rows || result || [];
    res.json({ ok: true, count: shots.length, shots });
  } catch (err: any) {
    console.error("[worker/audio-queue] error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
