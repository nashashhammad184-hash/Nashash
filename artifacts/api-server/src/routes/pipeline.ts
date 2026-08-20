import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { seriesTable, seasonsTable, episodesTable, realScenesTable, realShotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

// 1. Create Series
router.post("/series", async (req, res): Promise<void> => {
  const { projectId, title, description } = req.body;
  if (!projectId || !title) {
    res.status(400).json({ error: "Project ID and Title are required" });
    return;
  }
  try {
    const [created] = await db.insert(seriesTable).values({ projectId: parseInt(projectId, 10), title, description }).returning();
    res.status(201).json({ success: true, series: created });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 2. Create Season
router.post("/seasons", async (req, res): Promise<void> => {
  const { seriesId, seasonNumber, title } = req.body;
  if (!seriesId || !seasonNumber) {
    res.status(400).json({ error: "Series ID and Season Number are required" });
    return;
  }
  try {
    const [created] = await db.insert(seasonsTable).values({ seriesId: parseInt(seriesId, 10), seasonNumber: parseInt(seasonNumber, 10), title }).returning();
    res.status(201).json({ success: true, season: created });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 3. Create Episode
router.post("/episodes", async (req, res): Promise<void> => {
  const { seasonId, episodeNumber, title, summary } = req.body;
  if (!seasonId || !episodeNumber || !title) {
    res.status(400).json({ error: "Season ID, Episode Number and Title are required" });
    return;
  }
  try {
    const [created] = await db.insert(episodesTable).values({ seasonId: parseInt(seasonId, 10), episodeNumber: parseInt(episodeNumber, 10), title, summary }).returning();
    res.status(201).json({ success: true, episode: created });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 4. Validate and Fetch Scene & Shots
router.get("/scenes/:id/shots", async (req, res): Promise<void> => {
  const sceneId = parseInt(req.params.id, 10);
  if (isNaN(sceneId)) {
    res.status(400).json({ error: "Invalid Scene ID" });
    return;
  }
  try {
    const scene = await db.select().from(realScenesTable).where(eq(realScenesTable.id, sceneId)).limit(1);
    if (scene.length === 0) {
      res.status(404).json({ error: "Scene not found inside the active story bible" });
      return;
    }
    const shots = await db.select().from(realShotsTable).where(eq(realShotsTable.id, sceneId)).orderBy(realShotsTable.shotOrder);
    res.json({ success: true, scene: scene[0], shots });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

export default router;
