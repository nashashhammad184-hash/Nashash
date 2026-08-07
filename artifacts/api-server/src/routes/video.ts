import { Router, type IRouter } from "express";
import { GenerateVideoBody, GenerateVideoResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const DEMO_MP4_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const MAX_PROVIDER_ATTEMPTS = 10;
const PROVIDER_REQUEST_TIMEOUT_MS = 8_000;
const PROVIDER_RETRY_DELAY_MS = 2_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function isVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return /\.(mp4|webm|mov)(?:$|[?#])/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function findVideoUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return isVideoUrl(trimmed) ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  // Prefer explicit video fields. Providers commonly use one of these shapes:
  // output: ["https://...mp4"], output: { video_url: "..." }, or data.url.
  const explicit = firstString(
    record.video_url,
    record.videoUrl,
    record.mp4_url,
    record.mp4Url,
    record.download_url,
    record.downloadUrl,
    record.url,
  );
  if (explicit && isVideoUrl(explicit)) return explicit;

  for (const child of Object.values(record)) {
    const found = findVideoUrl(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findJobId(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return firstString(record.id, record.job_id, record.jobId, record.task_id, record.taskId);
}

function findStatus(value: unknown): string {
  const record = asRecord(value);
  return (firstString(record?.status, record?.state, record?.phase) ?? "").toLowerCase();
}

function findStatusUrl(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const url = firstString(
    record.status_url,
    record.statusUrl,
    record.polling_url,
    record.pollingUrl,
  );
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function isTerminalFailure(status: string): boolean {
  return ["failed", "error", "cancelled", "canceled", "rejected", "expired"].includes(status);
}

async function providerFetch(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    throw new Error(`Video provider returned ${response.status}`);
  }
  return payload;
}

function getProviderConfig(): { endpoint: string; apiKey?: string; statusTemplate?: string } | null {
  const endpoint = process.env["VIDEO_ENGINE_API_URL"]?.trim();
  if (!endpoint) return null;
  return {
    endpoint,
    apiKey: process.env["VIDEO_ENGINE_API_KEY"]?.trim(),
    statusTemplate: process.env["VIDEO_ENGINE_STATUS_URL_TEMPLATE"]?.trim(),
  };
}

async function generateFromProvider(input: {
  prompt: string;
  worldId: string;
  microExpression?: string;
}): Promise<{ videoUrl: string; jobId?: string }> {
  const config = getProviderConfig();
  if (!config) {
    // The app remains testable without credentials, but never pretends this is
    // an AI result. Configure VIDEO_ENGINE_API_URL for the real provider.
    return { videoUrl: DEMO_MP4_URL };
  }

  const providerPayload = await providerFetch(config.endpoint, {
    method: "POST",
    headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
    body: JSON.stringify({
      prompt: input.prompt,
      duration: 5,
      aspect_ratio: "16:9",
      world_id: input.worldId,
      micro_expression: input.microExpression ?? null,
    }),
  });

  const directUrl = findVideoUrl(providerPayload);
  if (directUrl) return { videoUrl: directUrl, jobId: findJobId(providerPayload) };

  const jobId = findJobId(providerPayload);
  const status = findStatus(providerPayload);
  const statusUrl =
    findStatusUrl(providerPayload) ??
    (config.statusTemplate && jobId
      ? config.statusTemplate.replace("{jobId}", encodeURIComponent(jobId))
      : undefined);

  if (!jobId || !statusUrl) {
    throw new Error("Video provider did not return a video URL or a pollable job");
  }

  let latestStatus = status;
  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_RETRY_DELAY_MS));
    }

    const result = await providerFetch(statusUrl, {
      method: "GET",
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    const videoUrl = findVideoUrl(result);
    if (videoUrl) return { videoUrl, jobId };

    latestStatus = findStatus(result);
    if (isTerminalFailure(latestStatus)) {
      throw new Error(`Video provider job ended with status: ${latestStatus}`);
    }
  }

  throw new Error(
    `Video provider did not complete within the bounded wait window (last status: ${latestStatus || "unknown"})`,
  );
}

router.post("/video/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await generateFromProvider(parsed.data);
    res.json(
      GenerateVideoResponse.parse({
        videoUrl: result.videoUrl,
        status: "completed",
        provider: getProviderConfig() ? "configured-engine" : "demo-preview",
        jobId: result.jobId ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Video generation failed");
    res.status(502).json({
      error: "Video generation failed",
      message: error instanceof Error ? error.message : "Unknown provider error",
    });
  }
});

export default router;