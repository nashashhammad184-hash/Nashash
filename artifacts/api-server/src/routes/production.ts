import { Router, type Request, type Response } from "express";
import { createProductionJob, getProductionJob, listProductionJobs } from "../lib/productionEngine";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router = Router();

router.get("/production/config", async (req: Request, res: Response): Promise<void> => {
  res.json({
    provider: process.env.VOICE_PROVIDER || "Deepgram",
    videoProvider: "Local-G5-GPU",
    status: "active"
  });
});

router.post("/production/jobs", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const { type, projectId, taskId, prompt, text, videoUrl, audioUrl, model } = req.body;
  if (!type) {
    res.status(400).json({ error: "نوع مهمة الإنتاج (type) مطلوب بشكل صريح." });
    return;
  }
  try {
    console.log(`⚡ [Production Pipeline] إطلاق مَهمة إنتاج حية من نوع [${type}] للمشروع رقم #${projectId || 'N/A'}`);
    const job = await createProductionJob(type, {
      projectId: projectId ? parseInt(String(projectId), 10) : undefined,
      taskId: taskId ? parseInt(String(taskId), 10) : undefined,
      prompt, text, videoUrl, audioUrl, model
    });
    res.status(202).json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ error: "فشل حقن المهمة في محرك التوليد", message: error.message });
  }
});

router.get("/production/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params.id);
  try {
    const job = await getProductionJob(jobId);
    if (!job) {
      res.status(404).json({ error: "مَهمة الإنتاج المطلوبة غير موجودة في قاعدة البيانات حالياً." });
      return;
    }
    res.json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ error: "فشل تتبع حالة المهمة", message: error.message });
  }
});

router.get("/production/projects/:projectId/jobs", async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.projectId), 10);
  try {
    const jobs = await listProductionJobs(isNaN(projectId) ? undefined : projectId);
    res.json({ success: true, jobs });
  } catch (error: any) {
    res.status(500).json({ error: "فشل جلب مهام المشروع", message: error.message });
  }
});

export default router;
