import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, seriesSeasonsTable, seriesEpisodesTable } from "@workspace/db";

const router: IRouter = Router();

// 1. جلب مواسم مسلسل معين
router.get("/projects/:projectId/seasons", async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const seasons = await db
      .select()
      .from(seriesSeasonsTable)
      .where(eq(seriesSeasonsTable.projectId, projectId));
    res.json(seasons);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. إنشاء موسم جديد لمسلسل
router.post("/projects/:projectId/seasons", async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const { seasonNumber, title } = req.body;
    const [season] = await db
      .insert(seriesSeasonsTable)
      .values({ projectId, seasonNumber, title })
      .returning();
    res.status(201).json(season);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. جلب حلقات موسم معين
router.get("/seasons/:seasonId/episodes", async (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId);
    const episodes = await db
      .select()
      .from(seriesEpisodesTable)
      .where(eq(seriesEpisodesTable.seasonId, seasonId));
    res.json(episodes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. إنشاء حلقة جديدة داخل موسم
router.post("/seasons/:seasonId/episodes", async (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId);
    const { episodeNumber, title, summary } = req.body;
    const [episode] = await db
      .insert(seriesEpisodesTable)
      .values({ seasonId, episodeNumber, title, summary })
      .returning();
    res.status(201).json(episode);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
