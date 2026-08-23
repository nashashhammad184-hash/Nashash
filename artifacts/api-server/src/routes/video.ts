import { Router, type IRouter } from "express";
import { db, videoGenerationJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { URL } from "url";
import { ip } from "address"; // لفحص حظر عناوين الـ IP بمرونة إن وجدت

const router: IRouter = Router();

// دالة أمنية صارمة لفحص الـ URL ومنع ثغرات الـ SSRF (إصلاح 17)
function validateProxyUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();

    // 1. حظر العناوين المحلية والداخلية وعناوين الـ Loopback الصارمة
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1"
    ) {
      return false;
    }

    // 2. حظر نطاقات شبكات النطاق المحلي الخاصة (Private IP Ranges: 10.x, 172.16-31.x, 192.168.x)
    if (
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.")
    ) {
      return false;
    }
    // فحص نطاق الـ 172.16.x.x إلى 172.31.x.x
    if (hostname.startsWith("172.")) {
      const parts = hostname.split(".");
      const secondPart = parseInt(parts[1] || "0", 10);
      if (secondPart >= 16 && secondPart <= 31) {
        return false;
      }
    }

    // 3. حظر رابط الـ AWS Cloud Metadata / Internal Address الشهير (169.254.169.254)
    if (hostname.startsWith("169.254.")) {
      return false;
    }

    // 4. التحقق الصارم عبر القائمة البيضاء (Allowlist) الممررة من Environment Variables
    const allowlistEnv = process.env["ALLOWED_VIDEO_PROVIDERS"]; // يأتي على شكل: 'engine.kayan.ai,://amazonaws.com'
    if (!allowlistEnv) {
      // إذا لم يتم تهيئة القائمة البيضاء وكان في الإنتاج، نرفض لزيادة الأمان
      return false;
    }

    const allowedHosts = allowlistEnv.split(",").map(h => h.trim().toLowerCase());
    
    // يجب أن يكون المضيف متواجد داخل القائمة المسموحة
    const isAllowed = allowedHosts.some(allowedHost => hostname === allowedHost || hostname.endsWith("." + allowedHost));
    
    return isAllowed;

  } catch {
    return false; // أي رابط غير صالح البنية يتم رفضه فوراً
  }
}

// مسار بث الفيديوهات بالوكالة المؤمن (إصلاح 17)
router.get("/video/stream", async (req, res): Promise<void> => {
  const targetUrl = req.query["url"] as string | undefined;

  if (!targetUrl) {
    res.status(400).json({ error: "url parameter is required" });
    return;
  }

  // تطبيق الفحص الأمني الصارم ومنع الاختراقات والـ SSRF
  if (!validateProxyUrl(targetUrl)) {
    res.status(403).json({
      error: "FORBIDDEN_PROXY_TARGET",
      message: "The requested URL host is untrusted, local, or blocked by security policies."
    });
    return;
  }

  try {
    // إجراء الـ Fetch الآمن بعد تخطي الجدار الأمني وعمل مواسير البث (Stream Piping) للمتصفح
    const response = await fetch(targetUrl);
    if (!response.ok) {
      res.status(response.status).json({ error: "Failed to fetch video asset from provider" });
      return;
    }

    // نقل الـ Headers الأساسية ونقل حزمة البث بسلام
    res.setHeader("Content-Type", response.headers.get("Content-Type") || "video/mp4");
    
    if (response.body) {
      const reader = response.body.getReader();
      // دالة التمرير الآمن ومواسير البث لحصتك المجانية
      const stream = new ReadableStream({
        async start(controller) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            res.write(value); // الكتابة المباشرة في المتصفح لتوفير الذاكرة العشوائية
          }
          controller.close();
          res.end();
        }
      });
    } else {
      res.sendStatus(500);
    }

  } catch (error: any) {
    res.status(500).json({ error: "Proxy connection failure" });
  }
});

// ── مسارات توليد وجدولة الوظائف (مستقرة ومبنية بسلام في إصلاح 15) ──
router.post("/video/generate", async (req, res): Promise<void> => {
  const { shotId, prompt } = req.body;
  if (!shotId || !prompt) {
    res.status(400).json({ error: "shotId and prompt are required" });
    return;
  }
  try {
    const [newJob] = await db.insert(videoGenerationJobsTable).values({ shotId: parseInt(shotId, 10), prompt: prompt, status: "queued" }).returning();
    
    // محاكي الـ Worker الخلفي الآمن والخفيف لحصتك المجانية
    setTimeout(async () => {
      try {
        const jobId = newJob.id;
        const videoEngineUrl = process.env["VIDEO_ENGINE_API_URL"];
        const isProduction = process.env["NODE_ENV"] === "production";
        const isDemoModeEnabled = process.env["VIDEO_DEMO_MODE"] === "true";

        await db.update(videoGenerationJobsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(videoGenerationJobsTable.id, jobId));

        if (!videoEngineUrl && (isProduction || !isDemoModeEnabled)) {
          await db.update(videoGenerationJobsTable).set({ status: "failed", errorLog: "VIDEO_ENGINE_NOT_CONFIGURED", updatedAt: new Date() }).where(eq(videoGenerationJobsTable.id, jobId));
          return;
        }

        let finalUrl = "https://mozilla.net";
        if (videoEngineUrl) {
          finalUrl = `${videoEngineUrl}/render?prompt=${encodeURIComponent(prompt)}`;
        }
        await db.update(videoGenerationJobsTable).set({ status: "completed", videoUrl: finalUrl, updatedAt: new Date() }).where(eq(videoGenerationJobsTable.id, jobId));
      } catch (err: any) {
        await db.update(videoGenerationJobsTable).set({ status: "failed", errorLog: err.message, updatedAt: new Date() }).where(eq(videoGenerationJobsTable.id, newJob.id));
      }
    }, 500);

    res.status(202).json({ message: "Video generation job accepted and queued successfully", jobId: newJob.id, status: "queued" });
  } catch {
    res.status(500).json({ error: "Failed to initialize video job" });
  }
});

router.get("/video/jobs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select().from(videoGenerationJobsTable).where(eq(videoGenerationJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Video generation job not found" });
    return;
  }
  res.json({ id: job.id, shotId: job.shotId, status: job.status, videoUrl: job.videoUrl, errorLog: job.errorLog, createdAt: job.createdAt, updatedAt: job.updatedAt });
});

export default router;
