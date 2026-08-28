import { Router, type IRouter } from "express";
import { GenerateVideoBody, GenerateVideoResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// مسار افتراضي مستخدم من واجهة الإنتاج لتزويد الحالة ومزود الخدمة الحالي
router.get("/production/config", async (req, res): Promise<void> => {
  res.json({
    provider: process.env.VOICE_PROVIDER || "Deepgram",
    status: "active"
  });
});

export default router;
