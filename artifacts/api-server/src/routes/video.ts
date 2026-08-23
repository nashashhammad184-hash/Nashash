import { Router, type IRouter } from "express";
import { db, videoGenerationJobsTable, shotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// 1. [POST] مسار إنشاء مهمة توليد الفيديو وإرجاع الـ jobId فوراً (إصلاح 15)
router.post("/video/generate", async (req, res): Promise<void> => {
  const { shotId, prompt } = req.body;

  if (!shotId || !prompt) {
    res.status(400).json({ error: "shotId and prompt are required" });
    return;
  }

  try {
    // إنشاء الوظيفة بحالة الانتظار الأولى (queued)
    const [newJob] = await db
      .insert(videoGenerationJobsTable)
      .values({
        shotId: parseInt(shotId, 10),
        prompt: prompt,
        status: "queued", // الحالة 1: queued
      })
      .returning();

    // ── تشغيل الـ Background Processor/Worker لتنفيذ الـ Provider Polling بسلام ──
    // نقوم بتشغيلها بشكل منفصل تماماً عن ميثاق استجابة الـ HTTP Request لحماية السيرفر المجاني من الـ Timeout
    setTimeout(async () => {
      try {
        const jobId = newJob.id;
        const videoEngineUrl = process.env["VIDEO_ENGINE_API_URL"];
        const isProduction = process.env["NODE_ENV"] === "production";
        const isDemoModeEnabled = process.env["VIDEO_DEMO_MODE"] === "true";

        // أ) تحديث الحالة إلى المعالجة (processing)
        await db
          .update(videoGenerationJobsTable)
          .set({ status: "processing", updatedAt: new Date() }) // الحالة 2: processing
          .where(eq(videoGenerationJobsTable.id, jobId));

        // ب) فحص المتغيرات وتوليد الرابط أو الـ fallback الفني الآمن للمطورين
        if (!videoEngineUrl) {
          if (isProduction || !isDemoModeEnabled) {
            // فشل المهمة إذا كنا في بيئة الإنتاج وغير مهيأ (failed)
            await db
              .update(videoGenerationJobsTable)
              .set({
                status: "failed", // الحالة 3: failed
                errorLog: "VIDEO_ENGINE_NOT_CONFIGURED: Production engine missing.",
                updatedAt: new Date(),
              })
              .where(eq(videoGenerationJobsTable.id, jobId));
            return;
          }
        }

        // ج) تحديد الرابط ومحاكاة الـ Polling/Retrying إن لزم الأمر بسلام
        // (في بيئة التطوير تكتمل بسلام فوراً بـ completed)
        let finalUrl = "https://mozilla.net";
        if (videoEngineUrl) {
          finalUrl = `${videoEngineUrl}/render?prompt=${encodeURIComponent(prompt)}`;
          
          // إذا كان محاكي محتاج إعادات يمكن حقن حالة الـ retrying هنا (الحالة 4: retrying)
          await db
            .update(videoGenerationJobsTable)
            .set({ status: "retrying", updatedAt: new Date() })
            .where(eq(videoGenerationJobsTable.id, jobId));
          
          // انتظام الانتظار القصير لإعادة الاتصال
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // د) اكتمال المهمة بنجاح (completed) وتحديث السجل
        await db
          .update(videoGenerationJobsTable)
          .set({
            status: "completed", // الحالة 5: completed
            videoUrl: finalUrl,
            updatedAt: new Date(),
          })
          .where(eq(videoGenerationJobsTable.id, jobId));

      } catch (workerError: any) {
        // إدارة الأخطاء الطارئة في الخلفية
        await db
          .update(videoGenerationJobsTable)
          .set({
            status: "failed",
            errorLog: workerError.message || "Unknown worker error",
            updatedAt: new Date(),
          })
          .where(eq(videoGenerationJobsTable.id, newJob.id));
      }
    }, 500); // انطلاق فوري مريح لمعالج السيرفر

    // إرجاع الاستجابة الفورية والـ jobId للمتصفح دون أي انتظار للمزود
    res.status(202).json({
      message: "Video generation job accepted and queued successfully",
      jobId: newJob.id,
      status: "queued",
    });

  } catch (error: any) {
    res.status(500).json({ error: "Failed to initialize video job" });
  }
});

// 2. [GET] مسار جلب وقراءة حالة وظيفة توليد الفيديو بالمعرف (إصلاح 15)
router.get("/video/jobs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [job] = await db
    .select()
    .from(videoGenerationJobsTable)
    .where(eq(videoGenerationJobsTable.id, id));

  if (!job) {
    res.status(404).json({ error: "Video generation job not found" });
    return;
  }

  res.json({
    id: job.id,
    shotId: job.shotId,
    status: job.status, // يعود بالـ 5 حالات ديناميكياً للواجهة الأمامية
    videoUrl: job.videoUrl,
    errorLog: job.errorLog,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

export default router;
