import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const REPLICATE_PREDICTIONS_ENDPOINT = "https://api.replicate.com/v1/predictions";
const MAX_POLLING_ATTEMPTS = 80;
const POLLING_INTERVAL_MS = 3_000;
const HTTP_TIMEOUT_MS = 20_000;

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

function extractOutputUrl(output: unknown): string | undefined {
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

function buildModelInput(body: Record<string, any>): Record<string, unknown> {
  if (body.input && typeof body.input === "object") {
    return body.input as Record<string, unknown>;
  }

  const video = body.videoUrl || body.video || body.face || body.face_video || body.source_image;
  const audio = body.audioUrl || body.audio || body.input_audio || body.driven_audio;

  if (!video || !audio) {
    throw new Error("Both video (or face) and audio URLs are required for lip sync.");
  }

  return {
    face: video,
    input_audio: audio,
  };
}

async function runLipSyncPrediction(reqBody: Record<string, any>): Promise<{ outputUrl: string; predictionId: string; status: string }> {
  const apiToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not configured.");
  }

  const modelVersion = process.env.REPLICATE_LIPSYNC_MODEL_VERSION?.trim();
  if (!modelVersion) {
    throw new Error("REPLICATE_LIPSYNC_MODEL_VERSION environment variable is not configured.");
  }

  const modelInput = buildModelInput(reqBody);

  console.log("==> [LIPSYNC] Calling Replicate API with version:", modelVersion);

  const createResponse = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version: modelVersion,
      input: modelInput,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => "");
    throw new Error(`Replicate LipSync API returned HTTP ${createResponse.status}: ${errorText}`);
  }

  let prediction = (await createResponse.json()) as ReplicatePrediction;
  console.log("==> [LIPSYNC] Prediction Created:", prediction?.id, "Status:", prediction?.status);

  if (!prediction || !prediction.id) {
    throw new Error("Replicate API did not return a valid prediction object.");
  }

  const pollingUrl = prediction.urls?.get || `${REPLICATE_PREDICTIONS_ENDPOINT}/${prediction.id}`;

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    if (prediction.status === "succeeded") {
      const outputUrl = extractOutputUrl(prediction.output);
      if (!outputUrl) {
        throw new Error("LipSync prediction succeeded but returned no valid video URL in output.");
      }
      return { outputUrl, predictionId: prediction.id, status: "succeeded" };
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
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!pollResponse.ok) {
      const pollErrorText = await pollResponse.text().catch(() => "");
      throw new Error(`Replicate LipSync polling failed with HTTP ${pollResponse.status}: ${pollErrorText}`);
    }

    prediction = (await pollResponse.json()) as ReplicatePrediction;
    console.log(`==> [LIPSYNC Poll #${attempt + 1}] Status: ${prediction.status}`);
  }

  throw new Error(`LipSync prediction timed out after ${MAX_POLLING_ATTEMPTS * (POLLING_INTERVAL_MS / 1000)} seconds.`);
}

async function handleLipSync(req: Request, res: Response): Promise<void> {
  try {
    const result = await runLipSyncPrediction(req.body || {});

    res.status(200).json({
      success: true,
      predictionId: result.predictionId,
      status: result.status,
      outputUrl: result.outputUrl,
      syncedVideoUrl: result.outputUrl,
    });
  } catch (error) {
    logger.error({ err: error }, "LipSync generation failed");
    res.status(502).json({
      success: false,
      error: "LipSync generation failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

router.post("/", handleLipSync);
router.post("/generate", handleLipSync);
router.post("/lipsync", handleLipSync);
router.post("/lipsync/generate", handleLipSync);

export default router;
