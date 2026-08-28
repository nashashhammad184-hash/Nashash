// @ts-nocheck
import { Router, type IRouter, type Request, type Response } from "express";
import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 30000;
const MAX_POLLING_ATTEMPTS = 60;
const POLLING_DELAY_MS = 4000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RENDERS_DIR = path.resolve(__dirname, "../../../studio/dist/public/renders");

router.post("/render/merge", async (req: Request, res: Response): Promise<void> => {
  const { prompt, worldId, text, timelineSubs, microExpression } = req.body || {};
  if (!prompt || !text || !worldId) {
    res.status(400).json({ error: "prompt, text, and worldId are required for comprehensive final render." });
    return;
  }

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const timestamp = Date.now();

  const tempAudioPath = path.join(RENDERS_DIR, `temp_audio_${timestamp}.mp3`);
  const tempLipVideoPath = path.join(RENDERS_DIR, `temp_lip_${timestamp}.mp4`);
  const tempSrtPath = path.join(RENDERS_DIR, `temp_sub_${timestamp}.srt`);
  const finalVideoName = `final_render_${timestamp}.mp4`;
  const finalVideoPath = path.join(RENDERS_DIR, finalVideoName);

  try {
    if (!fs.existsSync(RENDERS_DIR)) {
      fs.mkdirSync(RENDERS_DIR, { recursive: true });
    }

    let srtContent = "";
    if (Array.isArray(timelineSubs) && timelineSubs.length > 0) {
      timelineSubs.forEach((sub: { index: number; start: string; end: string; text: string }) => {
        srtContent += `${sub.index}\n${sub.start} --> ${sub.end}\n${sub.text}\n\n`;
      });
    } else {
      srtContent = `1\n00:00:00,000 --> 00:00:07,000\n${text}\n\n`;
    }
    fs.writeFileSync(tempSrtPath, srtContent, "utf8");

    req.log?.info("=== Stage 1: Audio Production via Deepgram ===");
    const audioResponse = await fetch("https://deepgram.com", {
      method: "POST",
      headers: {
        "Authorization": `Token ${deepgramKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!audioResponse.ok) throw new Error("Deepgram core generation failed.");
    const audioBuffer = await audioResponse.arrayBuffer();
    fs.writeFileSync(tempAudioPath, Buffer.from(audioBuffer));
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");
    const audioDataUrl = `data:audio/mp3;base64,${audioBase64}`;

    req.log?.info("=== Stage 2: Visual Production via Replicate ===");
    const videoResponse = await fetch("https://replicate.com", {
      method: "POST",
      headers: {
        "Authorization": `Token ${replicateToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "c452144365b40e53a99e46a78bd3bc957117f763f03bda00f77bcbe867f0868c",
        input: { prompt, world_id: worldId, micro_expression: microExpression || "neutral" }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!videoResponse.ok) throw new Error("Replicate Video execution failed.");
    const videoPrediction = await videoResponse.json() as { urls: { get: string } };
    
    let rawVideoUrl: string | null = null;
    for (let i = 0; i < MAX_POLLING_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, POLLING_DELAY_MS));
      const p = await fetch(videoPrediction.urls.get, { headers: { "Authorization": `Token ${replicateToken}` } });
      const d = await p.json() as { status: string; output?: string | string[] };
      if (d.status === "succeeded") {
        rawVideoUrl = Array.isArray(d.output) ? d.output : d.output || null;
        break;
      }
      if (["failed", "canceled"].includes(d.status)) throw new Error("Raw video generation failed.");
    }
    if (!rawVideoUrl) throw new Error("Raw video generation timed out.");

    req.log?.info("=== Stage 3: Real Lip Sync Execution ===");
    const lipResponse = await fetch("https://replicate.com", {
      method: "POST",
      headers: {
        "Authorization": `Token ${replicateToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "2444ff76f1e8e2fa012b184da3109a96e6255152026ae611c0fe20c43665bc72",
        input: { face: rawVideoUrl, audio: audioDataUrl }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!lipResponse.ok) throw new Error("Lip Sync orchestration failed.");
    const lipPrediction = await lipResponse.json() as { urls: { get: string } };
    
    let syncedVideoUrl: string | null = null;
    for (let i = 0; i < MAX_POLLING_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, POLLING_DELAY_MS));
      const p = await fetch(lipPrediction.urls.get, { headers: { "Authorization": `Token ${replicateToken}` } });
      const d = await p.json() as { status: string; output?: string | string[] };
      if (d.status === "succeeded") {
        syncedVideoUrl = Array.isArray(d.output) ? d.output : d.output || null;
        break;
      }
      if (["failed", "canceled"].includes(d.status)) throw new Error("Lip Sync processing collapsed on Replicate.");
    }
    if (!syncedVideoUrl) throw new Error("Lip Sync pipeline timed out.");

    const lipFileResponse = await fetch(syncedVideoUrl);
    if (!lipFileResponse.ok) throw new Error("Failed to process server CDN audio-visual track.");
    const lipVideoBuffer = await lipFileResponse.arrayBuffer();
    fs.writeFileSync(tempLipVideoPath, Buffer.from(lipVideoBuffer));

    req.log?.info("=== Stage 4: Optimized Arabic Subtitle Hardcoding ===");
    const ffmpegCommand = `ffmpeg -y -i "${tempLipVideoPath}" -i "${tempAudioPath}" -vf "subtitles='${tempSrtPath}':charenc=UTF-8:force_style='FontName=KacstOne,FontSize=16'" -c:v libx264 -preset superfast -crf 22 -c:a aac -map 0:v:0 -map 1:a:0 "${finalVideoPath}"`;
    
    exec(ffmpegCommand, (execError, stdout, stderr) => {
      try {
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        if (fs.existsSync(tempLipVideoPath)) fs.unlinkSync(tempLipVideoPath);
        if (fs.existsSync(tempSrtPath)) fs.unlinkSync(tempSrtPath);
      } catch (e) {
        req.log?.warn({ err: e }, "Files cleanup warning");
      }

      if (execError) {
        req.log?.error({ err: execError, stderr }, "FFmpeg subtitle burn failed");
        res.status(502).json({ error: "FFmpeg execution error", details: stderr });
        return;
      }

      req.log?.info({ finalVideoName }, "Arabic Render Pipeline Executed Safely on Free Tier");
      res.json({
        success: true,
        videoUrl: `/renders/${finalVideoName}`,
        downloadUrl: `/renders/${finalVideoName}`,
        streamUrl: `/renders/${finalVideoName}`,
        provider: "kayan-arabic-render-pipeline"
      });
    });

  } catch (error) {
    try {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      if (fs.existsSync(tempLipVideoPath)) fs.unlinkSync(tempLipVideoPath);
      if (fs.existsSync(tempSrtPath)) fs.unlinkSync(tempSrtPath);
    } catch {}
    res.status(502).json({ error: "Pipeline failed", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

export default router;
