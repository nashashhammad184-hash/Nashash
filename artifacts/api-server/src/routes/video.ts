import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateVideoBody, GenerateVideoResponse } from "@workspace/api-zod";
import { Readable } from "node:stream";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const REPLICATE_PREDICTIONS_ENDPOINT = "https://api.replicate.com/v1/predictions";
const MAX_POLLING_ATTEMPTS = 60;
const POLLING_INTERVAL_MS = 3_000;
const HTTP_TIMEOUT_MS = 15_000;

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

function extractVideoUrl(output: unknown): string | undefined {
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
    for (const key of ["video", "video_url", "url", "output"]) {
      const val = record[key];
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
  }

  return undefined;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.")
    );
  } catch {
    return false;
  }
}

function getDownloadUrl(videoUrl: string): string {
  return `/api/video/download?url=${encodeURIComponent(videoUrl)}`;
}

async function proxyVideo(req: Request, res: Response, asDownload: boolean) {
  const requestedUrl = typeof req.query["url"] === "string" ? (req.query["url"] as string) : "";
  if (!isPublicHttpUrl(requestedUrl)) {
    res.status(400).json({ error: "A public HTTPS video URL is required." });
    return;
  }

  try {
    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const upstream = await fetch(requestedUrl, {
      headers: range ? { range } : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "Video source is unavailable." });
      return;
    }

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    res.setHeader("Accept-Ranges", "bytes");
    if (asDownload) {
      res.setHeader("Content-Disposition", 'attachment; filename="kayan-production.mp4"');
    }

    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error) {
    logger.error({ err: error }, "Video proxy failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Video source could not be reached." });
    }
  }
}

async function executeReplicatePrediction(prompt: string): Promise<{ videoUrl: string; jobId: string }> {
  const apiToken = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not configured.");
  }

  const modelVersion = process.env.REPLICATE_VIDEO_MODEL_VERSION?.trim();
  if (!modelVersion) {
    throw new Error(
      "REPLICATE_VIDEO_MODEL_VERSION environment variable is not configured."
    );
  }

  const createResponse = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version: modelVersion,
      input: {
        prompt,
      },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => "");
    throw new Error(`Replicate API returned HTTP ${createResponse.status}: ${errorText}`);
  }

  let prediction = (await createResponse.json()) as ReplicatePrediction;

  if (!prediction || !prediction.id) {
    throw new Error("Replicate API did not return a valid prediction ID.");
  }

  const pollingUrl = prediction.urls?.get || `${REPLICATE_PREDICTIONS_ENDPOINT}/${prediction.id}`;

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    if (prediction.status === "succeeded") {
      const videoUrl = extractVideoUrl(prediction.output);
      if (!videoUrl) {
        throw new Error("Prediction status is 'succeeded' but no video URL was found in the output.");
      }
      return { videoUrl, jobId: prediction.id };
    }

    if (prediction.status === "failed") {
      throw new Error(`Replicate prediction failed: ${prediction.error || "Unknown execution error"}`);
    }

    if (prediction.status === "canceled") {
      throw new Error("Replicate prediction was canceled.");
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
      throw new Error(`Replicate polling failed with HTTP ${pollResponse.status}: ${pollErrorText}`);
    }

    prediction = (await pollResponse.json()) as ReplicatePrediction;
  }

  throw new Error(`Replicate prediction timed out after ${MAX_POLLING_ATTEMPTS * (POLLING_INTERVAL_MS / 1000)} seconds.`);
}

router.post("/video/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { videoUrl, jobId } = await executeReplicatePrediction(parsed.data.prompt);

    res.json(
      GenerateVideoResponse.parse({
        videoUrl,
        downloadUrl: getDownloadUrl(videoUrl),
        streamUrl: `/api/video/stream?url=${encodeURIComponent(videoUrl)}`,
        status: "completed",
        provider: "replicate",
        jobId,
      }),
    );
  } catch (error) {
    logger.error({ err: error }, "Replicate video generation failed");
    res.status(502).json({
      error: "Video generation failed",
      message: error instanceof Error ? error.message : "Unknown Replicate error",
    });
  }
});

router.get("/video/stream", async (req, res): Promise<void> => {
  await proxyVideo(req, res, false);
});

router.get("/video/download", async (req, res): Promise<void> => {
  await proxyVideo(req, res, true);
});

export default router;
