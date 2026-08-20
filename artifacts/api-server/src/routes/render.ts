import { Router, type IRouter } from "express";
import { db, finalRenderJobsTable, timelineClipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runContinuitySanityCheck, executeFinalRenderAssembly } from "../lib/renderEngine";

const router: IRouter = Router();

// 1. Trigger Timeline Final Render & Continuity check
router.post("/render/timeline-assembly", async (req, res): Promise<void> => {
  const { projectId, clips, watermarkText } = req.body;

  if (!projectId || !Array.isArray(clips)) {
    res.status(400).json({ error: "Project ID and clips timeline array are required" });
    return;
  }

  try {
    // تشغيل فحص الاستمرارية والاتساق السينمائي الصارم أولاً
    const check = await runContinuitySanityCheck(parseInt(projectId, 10), clips);

    if (check.result === "FAIL") {
      res.status(422).json({
        success: false,
        error: "Continuity Sanity Check Failed. Production asset blocked.",
        report: check.report
      });
      return;
    }

    // إنشاء مهمة الرندرة والدمج الحقيقية في قاعدة البيانات
    const [job] = await db.insert(finalRenderJobsTable).values({
      projectId: parseInt(projectId, 10),
      status: "QUEUED",
      continuityCheckResult: check.result,
      continuityReport: check.report
    }).returning();

    // تشغيل الـ FFmpeg Engine بشكل مستقل في الخلفية دون جعل خادم الـ HTTP ينتظر
    executeFinalRenderAssembly(job.id, {
      projectId: parseInt(projectId, 10),
      clips,
      watermarkText
    }).catch(console.error);

    res.status(202).json({
      success: true,
      message: "Timeline assembly initiated under active FFmpeg instance.",
      jobId: job.id,
      continuity: check.result
    });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 2. Fetch specific Render Job Status
router.get("/render/jobs/:id", async (req, res): Promise<void> => {
  const jobId = parseInt(req.params.id, 10);
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid Job ID" });
    return;
  }
  try {
    const [job] = await db.select().from(finalRenderJobsTable).where(eq(finalRenderJobsTable.id, jobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Render job profile not found" });
      return;
    }
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch render job data", message: String(error) });
  }
});

export default router;
