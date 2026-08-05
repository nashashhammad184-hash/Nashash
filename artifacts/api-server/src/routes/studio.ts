import { Router, type IRouter } from "express";
import { db, projectsTable, scriptsTable, actorsTable, shotsTable } from "@workspace/db";
import { GetStudioStatsResponse } from "@workspace/api-zod";
import { eq, count, sql } from "drizzle-orm";

const router: IRouter = Router();

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
