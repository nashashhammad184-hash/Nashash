import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEEPGRAM_TTS_ENDPOINT = "https://api.deepgram.com/v1/speak";
const DEFAULT_TTS_MODEL = "aura-asteria-en";
const HTTP_TIMEOUT_MS = 25_000;

function getAudioStorageDir(): string {
  const audioDir = path.resolve(process.cwd(), "uploads", "audio");
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  return audioDir;
}

async function handleTtsGeneration(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      error: "DEEPGRAM_API_KEY environment variable is not configured.",
    });
    return;
  }

  const model = process.env.DEEPGRAM_TTS_MODEL?.trim() || req.body?.model?.trim() || DEFAULT_TTS_MODEL;
  if (!model) {
    res.status(500).json({
      error: "DEEPGRAM_TTS_MODEL is required but not configured.",
    });
    return;
  }

  const text = (req.body?.text || req.body?.prompt || req.body?.script)?.toString().trim();
  if (!text) {
    res.status(400).json({
      error: "Text is required for TTS generation.",
    });
    return;
  }

  const voiceId = req.body?.voiceId || model;

  try {
    const url = `${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(model)}`;
    const upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text().catch(() => "");
      logger.error({ status: upstreamResponse.status, errorText }, "Deepgram TTS API returned an error");
      res.status(502).json({
        error: `Deepgram TTS API failed with status ${upstreamResponse.status}: ${errorText}`,
      });
      return;
    }

    const arrayBuffer = await upstreamResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!buffer || buffer.length === 0) {
      res.status(502).json({
        error: "Deepgram returned empty audio content.",
      });
      return;
    }

    const storageDir = getAudioStorageDir();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const filename = `voice-${timestamp}-${randomSuffix}.mp3`;
    const filePath = path.join(storageDir, filename);

    fs.writeFileSync(filePath, buffer);

    if (!fs.existsSync(filePath)) {
      res.status(500).json({ error: "Failed to persist audio file on disk." });
      return;
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      fs.unlinkSync(filePath);
      res.status(502).json({ error: "Generated audio file size is 0 bytes." });
      return;
    }

    const audioUrl = `/api/voice/audio/${filename}`;

    res.status(200).json({
      success: true,
      text,
      voiceId,
      model,
      audioUrl,
      fileSize: stats.size,
      filename,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate audio via Deepgram TTS");
    res.status(502).json({
      error: "Deepgram TTS generation failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function serveAudioFile(req: Request, res: Response): void {
  const rawFilename = req.params["filename"] as string | undefined;
  if (!rawFilename) {
    res.status(400).json({ error: "Filename is required." });
    return;
  }

  const safeFilename = path.basename(rawFilename);
  const filePath = path.join(getAudioStorageDir(), safeFilename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Audio file not found." });
    return;
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size === 0) {
    res.status(404).json({ error: "Invalid audio file." });
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Accept-Ranges", "bytes");

  fs.createReadStream(filePath).pipe(res);
}

// Support both /generate and /voice/generate regardless of how router is mounted
router.post("/generate", handleTtsGeneration);
router.post("/voice/generate", handleTtsGeneration);

// Support both /audio/:filename and /voice/audio/:filename
router.get("/audio/:filename", serveAudioFile);
router.get("/voice/audio/:filename", serveAudioFile);

export default router;
