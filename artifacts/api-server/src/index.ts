import express, { Router } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, seriesTable, seasonsTable, episodesTable, assetsTable, productionJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, "../../studio/dist/public");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 💥 ==================================================
// خامساً: إضافة الـ APIs والـ Validation والـ Retry لـ Pipeline الإنتاج
// ==================================================
const pipelineRouter = Router();

const createSeriesSchema = z.object({ projectId: z.number(), title: z.string().min(1), synopsis: z.string().optional() });
const createAssetSchema = z.object({
  projectId: z.number(),
  type: z.enum(["CHARACTER_REFERENCE", "WORLD_REFERENCE", "SCENE_REFERENCE", "SHOT_VIDEO", "VOICE", "MUSIC", "SFX", "SUBTITLE", "FINAL_RENDER"]),
  provider: z.string(),
  url: z.string().url(),
  metadata: z.record(z.any()).optional(),
  shotId: z.number().optional(),
  episodeId: z.number().optional(),
});
const createJobSchema = z.object({
  type: z.enum(["VIDEO_GENERATION", "VOICE_GENERATION", "LIP_SYNC", "AUDIO_GENERATION", "RENDER"]),
  projectId: z.number(),
  episodeId: z.number().optional(),
  sceneId: z.number().optional(),
  shotId: z.number().optional(),
  provider: z.string(),
  input: z.record(z.any()).optional(),
});

pipelineRouter.post("/series", async (req, res) => {
  try {
    const validated = createSeriesSchema.parse(req.body);
    const [newSeries] = await db.insert(seriesTable).values(validated).returning();
    res.status(201).json(newSeries);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

pipelineRouter.post("/series/:seriesId/seasons", async (req, res) => {
  try {
    const seriesId = parseInt(req.params.seriesId);
    const { seasonNumber, title } = req.body;
    const [newSeason] = await db.insert(seasonsTable).values({ seriesId, seasonNumber, title }).returning();
    res.status(201).json(newSeason);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

pipelineRouter.post("/seasons/:seasonId/episodes", async (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId);
    const { episodeNumber, title, synopsis } = req.body;
    const [newEpisode] = await db.insert(episodesTable).values({ seasonId, episodeNumber, title, synopsis }).returning();
    res.status(201).json(newEpisode);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

pipelineRouter.post("/assets", async (req, res) => {
  try {
    const validated = createAssetSchema.parse(req.body);
    const [newAsset] = await db.insert(assetsTable).values(validated).returning();
    res.status(201).json(newAsset);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

pipelineRouter.post("/jobs", async (req, res) => {
  try {
    const validated = createJobSchema.parse(req.body);
    const [newJob] = await db.insert(productionJobsTable).values({ ...validated, status: "QUEUED", retryCount: 0 }).returning();
    res.status(201).json(newJob);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

pipelineRouter.post("/jobs/:id/retry", async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const [job] = await db.select().from(productionJobsTable).where(eq(productionJobsTable.id, jobId)).limit(1);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "FAILED") return res.status(400).json({ error: "Only failed jobs can be retried" });
    if (job.retryCount >= 3) return res.status(400).json({ error: "Max retry limit reached (3 retries)" });

    const [updatedJob] = await db.update(productionJobsTable)
      .set({ status: "QUEUED", retryCount: job.retryCount + 1, error: null, startedAt: null, completedAt: null })
      .where(eq(productionJobsTable.id, jobId)).returning();
    res.status(200).json(updatedJob);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// تسجيل المسارات وخدمة واجهة الـ Studio الثابتة لـ AWS المجاني
app.use("/api/production-pipeline", pipelineRouter);
app.use(express.static(frontendDistPath));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  return res.sendFile(path.join(frontendDistPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
