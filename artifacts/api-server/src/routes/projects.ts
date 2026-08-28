import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { projectsTable, shotsTable, editClipsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const allProjects = await db.select().from(projectsTable);
    res.json({ success: true, projects: allProjects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/auto-edit", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const numericId = parseInt(String(id), 10);

  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid project ID format. Expected numeric ID." });
    return;
  }

  try {
    const project = await db.select().from(projectsTable).where(eq(projectsTable.id, numericId));
    if (!project || project.length === 0) {
      res.status(404).json({ error: "Project not found in DB" });
      return;
    }

    const projectShots = await db.select().from(shotsTable).where(eq(shotsTable.projectId, numericId));
    if (!projectShots || projectShots.length === 0) {
      res.status(400).json({ error: "No real shots found for this project" });
      return;
    }

    const clipsToInsert = projectShots.map((shot, index) => ({
      projectId: numericId,
      title: `Clip for Shot ${shot.id}`,
      durationSeconds: shot.durationSeconds || 5,
      clipOrder: index + 1,
      trackType: "video",
      startTime: 0,
      endTime: Number(shot.durationSeconds || 5),
      sourceStart: 0,
      sourceEnd: Number(shot.durationSeconds || 5),
      volume: 1.0
    }));

    const insertedClips = await db.insert(editClipsTable).values(clipsToInsert).returning();

    res.json({
      success: true,
      projectId: numericId,
      autoEdit: {
        status: "completed",
        decisions: insertedClips
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
