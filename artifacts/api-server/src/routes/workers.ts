import { Router, type Request, type Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { db, workerHeartbeatsTable } from "@workspace/db";

const router = Router();

router.post("/workers/heartbeat", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const name = String((req.body && req.body.name) || "").trim();
    res.status(400).json({ error: "INVALID_WORKER_NAME" });
    return;
  }
  const now = new Date();
  const metadata = typeof req.body.metadata === "string" 
    ? req.body.metadata.slice(0, 512) 
    : JSON.stringify(req.body.metadata || {}).slice(0, 512);
  
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

export default router;
