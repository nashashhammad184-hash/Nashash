import { Router, type IRouter } from "express";
import { db, generationJobsTable, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { processNextQueuedJob } from "../lib/productionEngine";

const router: IRouter = Router();

// 1. Trigger Video Production Job (Async Queue)
router.post("/production/video-job", async (req, res): Promise<void> => {
  const { shotId, prompt } = req.body;
  if (!shotId || !prompt) {
    res.status(400).json({ error: "Shot ID and Production Prompt are required" });
    return;
  }

  try {
    const provider = process.env.VIDEO_PROVIDER || "NOT_CONFIGURED";
    
    // إنشاء الوظيفة في طابور الانتظار فوراً وعدم جعل الـ HTTP ينتظر التوليد الطويل
    const [job] = await db.insert(generationJobsTable).values({
      shotId: parseInt(shotId, 10),
      type: "VIDEO_GEN",
      provider: provider,
      inputData: { prompt },
      status: "QUEUED"
    }).returning();

    // تشغيل الـ Worker الخلفي لمعالجة المهمة فوراً
    processNextQueuedJob().catch(console.error);

    res.status(202).json({ success: true, message: "Video generation job queued successfully", jobId: job.id });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 2. Trigger Voice Generation Job (Async Queue)
router.post("/production/voice-job", async (req, res): Promise<void> => {
  const { shotId, voiceId, dialogue } = req.body;
  if (!shotId || !voiceId || !dialogue) {
    res.status(400).json({ error: "ShotId, Voice ID and Dialogue text are required" });
    return;
  }

  try {
    const [job] = await db.insert(generationJobsTable).values({
      shotId: parseInt(shotId, 10),
      type: "VOICE_GEN",
      provider: process.env.VOICE_PROVIDER || "ElevenLabs",
      inputData: { voiceId, dialogue },
      status: "QUEUED"
    }).returning();

    processNextQueuedJob().catch(console.error);

    res.status(202).json({ success: true, message: "Voice generation job queued successfully", jobId: job.id });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 3. Get Assets Repository Status
router.get("/production/assets", async (req, res): Promise<void> => {
  try {
    const assets = await db.select().from(assetsTable).orderBy(assetsTable.createdAt);
    res.json({ success: true, assets });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch production assets", message: String(error) });
  }
});

export default router;
