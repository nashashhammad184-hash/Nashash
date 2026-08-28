import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEEPGRAM_TTS_ENDPOINT = "https://api.deepgram.com/v1/speak";
const REPLICATE_PREDICTIONS_ENDPOINT = "https://api.replicate.com/v1/predictions";
const DEFAULT_TTS_MODEL = "aura-asteria-en";
const MAX_POLLING_ATTEMPTS = 80;
const POLLING_INTERVAL_MS = 3_000;
const HTTP_TIMEOUT_MS = 25_000;

interface ReplicatePrediction {
  id: string;
  version?: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  error?: string | null;
  output?: unknown;
  urls?: {
    get?: string;
    cancel?: string;
  };
}

function extractMediaUrl(output: unknown): string | undefined {
  if (typeof output === "string" && output.trim().length > 0) {
    return output.trim();
  }
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string" && first.trim().length > 0) {
      return first.trim();
    }
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["video", "video_url", "url", "output", "synced_video"]) {
      const val = record[key];
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
  }
  return undefined;
}

function getRendersDir(): string {
  const rendersDir = path.resolve(process.cwd(), "uploads", "renders");
  if (!fs.existsSync(rendersDir)) {
    fs.mkdirSync(rendersDir, { recursive: true });
  }
  return rendersDir;
}

/**
 * 1. Deepgram TTS Stage
 */
async function generateAudioStage(text: string, deepgramKey: string, ttsModel: string): Promise<{ audioBuffer: Buffer; audioDataUri: string; audioPath: string }> {
  const url = `${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(ttsModel)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Deepgram TTS failed (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!buffer || buffer.length === 0) {
    throw new Error("Deepgram TTS returned 0 bytes of audio data.");
  }

  const timestamp = Date.now();
  const audioFileName = `render_audio_${timestamp}.mp3`;
  const audioPath = path.join(getRendersDir(), audioFileName);
  fs.writeFileSync(audioPath, buffer);

  const audioDataUri = `data:audio/mp3;base64,${buffer.toString("base64")}`;
  return { audioBuffer: buffer, audioDataUri, audioPath };
}

/**
 * 2. Replicate Video Generation Stage
 */
async function generateVideoStage(prompt: string, replicateToken: string, videoModelVersion: string): Promise<string> {
  const createResponse = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version: videoModelVersion,
      input: { prompt },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => "");
    throw new Error(`Replicate Video API returned HTTP ${createResponse.status}: ${errorText}`);
  }

  let prediction = (await createResponse.json()) as ReplicatePrediction;
  if (!prediction || !prediction.id) {
    throw new Error("Replicate Video API did not return a valid prediction ID.");
  }

  const pollingUrl = prediction.urls?.get || `${REPLICATE_PREDICTIONS_ENDPOINT}/${prediction.id}`;

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    if (prediction.status === "succeeded") {
      const videoUrl = extractMediaUrl(prediction.output);
      if (!videoUrl) {
        throw new Error("Replicate Video succeeded but returned no valid video URL.");
      }
      return videoUrl;
    }

    if (prediction.status === "failed") {
      throw new Error(`Replicate Video prediction failed: ${prediction.error || "Unknown error"}`);
    }

    if (prediction.status === "canceled") {
      throw new Error("Replicate Video prediction was canceled.");
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));

    const pollResponse = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!pollResponse.ok) {
      const pollErrorText = await pollResponse.text().catch(() => "");
      throw new Error(`Replicate Video polling failed (${pollResponse.status}): ${pollErrorText}`);
    }

    prediction = (await pollResponse.json()) as ReplicatePrediction;
  }

  throw new Error(`Replicate Video generation timed out after ${MAX_POLLING_ATTEMPTS * 3} seconds.`);
}

/**
 * 3. Replicate Lip Sync Stage
 */
async function generateLipSyncStage(videoUrl: string, audioDataUriOrUrl: string, replicateToken: string, lipsyncModelVersion: string): Promise<string> {
  const createResponse = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version: lipsyncModelVersion,
      input: {
        face: videoUrl,
        input_audio: audioDataUriOrUrl,
      },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => "");
    throw new Error(`Replicate LipSync API returned HTTP ${createResponse.status}: ${errorText}`);
  }

  let prediction = (await createResponse.json()) as ReplicatePrediction;
  if (!prediction || !prediction.id) {
    throw new Error("Replicate LipSync API did not return a valid prediction ID.");
  }

  const pollingUrl = prediction.urls?.get || `${REPLICATE_PREDICTIONS_ENDPOINT}/${prediction.id}`;

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    if (prediction.status === "succeeded") {
      const syncedUrl = extractMediaUrl(prediction.output);
      if (!syncedUrl) {
        throw new Error("Replicate LipSync succeeded but returned no valid video URL.");
      }
      return syncedUrl;
    }

    if (prediction.status === "failed") {
      throw new Error(`Replicate LipSync prediction failed: ${prediction.error || "Unknown error"}`);
    }

    if (prediction.status === "canceled") {
      throw new Error("Replicate LipSync prediction was canceled.");
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));

    const pollResponse = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!pollResponse.ok) {
      const pollErrorText = await pollResponse.text().catch(() => "");
      throw new Error(`Replicate LipSync polling failed (${pollResponse.status}): ${pollErrorText}`);
    }

    prediction = (await pollResponse.json()) as ReplicatePrediction;
  }

  throw new Error(`Replicate LipSync timed out after ${MAX_POLLING_ATTEMPTS * 3} seconds.`);
}

async function handleRenderPipeline(req: Request, res: Response): Promise<void> {
  const deepgramKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!deepgramKey) {
    res.status(500).json({ error: "DEEPGRAM_API_KEY environment variable is not configured." });
    return;
  }

  const replicateToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!replicateToken) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN environment variable is not configured." });
    return;
  }

  const videoModelVersion = process.env.REPLICATE_VIDEO_MODEL_VERSION?.trim();
  if (!videoModelVersion) {
    res.status(500).json({ error: "REPLICATE_VIDEO_MODEL_VERSION environment variable is not configured." });
    return;
  }

  const lipsyncModelVersion = process.env.REPLICATE_LIPSYNC_MODEL_VERSION?.trim();
  if (!lipsyncModelVersion) {
    res.status(500).json({ error: "REPLICATE_LIPSYNC_MODEL_VERSION environment variable is not configured." });
    return;
  }

  const { prompt, text } = req.body || {};
  if (!prompt || !text) {
    res.status(400).json({ error: "Both 'prompt' (for video) and 'text' (for speech) are required." });
    return;
  }

  const ttsModel = process.env.DEEPGRAM_TTS_MODEL?.trim() || req.body?.model?.trim() || DEFAULT_TTS_MODEL;

  try {
    logger.info("==> [RENDER PIPELINE] Starting Stage 1: Deepgram TTS...");
    const { audioDataUri, audioPath } = await generateAudioStage(text, deepgramKey, ttsModel);

    logger.info("==> [RENDER PIPELINE] Starting Stage 2: Replicate Video Generation...");
    const rawVideoUrl = await generateVideoStage(prompt, replicateToken, videoModelVersion);

    logger.info("==> [RENDER PIPELINE] Starting Stage 3: Replicate Lip Sync...");
    const syncedVideoUrl = await generateLipSyncStage(rawVideoUrl, audioDataUri, replicateToken, lipsyncModelVersion);

    res.status(200).json({
      success: true,
      status: "completed",
      videoUrl: rawVideoUrl,
      syncedVideoUrl,
      renderUrl: syncedVideoUrl,
      stages: {
        audio: "completed",
        video: "completed",
        lipsync: "completed",
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Render Pipeline failed");
    res.status(502).json({
      success: false,
      error: "Render Pipeline execution failed",
      message: error instanceof Error ? error.message : "Unknown pipeline error",
    });
  }
}

// Register render routes
router.post("/", handleRenderPipeline);
router.post("/merge", handleRenderPipeline);
router.post("/generate", handleRenderPipeline);

export default router;
