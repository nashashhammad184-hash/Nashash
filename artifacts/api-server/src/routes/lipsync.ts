import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { generateLipSyncKayanGpu } from "../lib/kayanGpuProvider";

const router: IRouter = Router();

router.post("/", handleLipSync);
router.post("/generate", handleLipSync);
router.post("/lipsync", handleLipSync);
router.post("/lipsync/generate", handleLipSync);

async function handleLipSync(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body || {};
    const videoPath = body.videoUrl || body.video || body.face || body.video_path;
    const audioPath = body.audioUrl || body.audio || body.input_audio || body.audio_path;
    if (!videoPath || !audioPath) {
      res.status(400).json({ success: false, error: "video and audio required" });
      return;
    }
    const result = await generateLipSyncKayanGpu({ videoPath, audioPath });
    res.status(200).json({
      success: true,
      jobId: result.jobId,
      status: "succeeded",
      outputUrl: result.videoUrl,
      syncedVideoUrl: result.videoUrl,
      provider: "kayangpu",
    });
  } catch (error) {
    logger.error({ err: error }, "LipSync failed");
    res.status(502).json({
      success: false,
      error: "LipSync generation failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export default router;
