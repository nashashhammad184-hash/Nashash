import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, scriptsTable, actorsTable, shotsTable } from "@workspace/db";
import { GetStudioStatsResponse } from "@workspace/api-zod";
import { count, sql } from "drizzle-orm";
import { createRenderJob, getRenderJobStatus } from "../lib/renderEngine";

const router: IRouter = Router();

// مسار بدء تشغيل الـ Final Render الحقيقي على السيرفر
router.post("/projects/:id/render/start", async (req: Request, res: Response): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "A valid project id is required." });
    return;
  }

  try {
    const job = await createRenderJob(projectId);
    res.json({ success: true, ...job });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "فشلت عملية تهيئة رندرة الفيلم."
    });
  }
});

// مسار تتبع حالة التصدير الحالية لـ Kayan AI Productions (إصلاح نوع البيانات صراحة)
router.get("/render/status/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params.jobId);
  const job = getRenderJobStatus(jobId);
  
  if (!job) {
    res.status(404).json({ error: "Render job not found" });
    return;
  }

  res.json({ success: true, ...job });
});

router.get("/studio/stats", async (_req, res): Promise<void> => {
  const [projectCounts] = await db
    .select({
      total: count(),
      active: sql<number>`SUM(CASE WHEN is_archived = false THEN 1 ELSE 0 END)::int`,
      archived: sql<number>`SUM(CASE WHEN is_archived = true THEN 1 ELSE 0 END)::int`,
    })
    .from(projectsTable);

  const [scriptCount] = await db.select({ total: count() }).from(scriptsTable);
  const [actorCount] = await db.select({ total: count() }).from(actorsTable);
  const [shotCount] = await db.select({ total: count() }).from(shotsTable);

  const worldCounts = await db
    .select({
      worldId: projectsTable.worldId,
      count: count(),
    })
    .from(projectsTable)
    .groupBy(projectsTable.worldId);

  res.json(
    GetStudioStatsResponse.parse({
      totalProjects: Number(projectCounts?.total ?? 0),
      activeProjects: Number(projectCounts?.active ?? 0),
      archivedProjects: Number(projectCounts?.archived ?? 0),
      totalScripts: Number(scriptCount?.total ?? 0),
      totalActors: Number(actorCount?.total ?? 0),
      totalShots: Number(shotCount?.total ?? 0),
      projectsByWorld: worldCounts.map((w) => ({
        worldId: w.worldId,
        count: Number(w.count),
      })),
    })
  );
});

export default router;
