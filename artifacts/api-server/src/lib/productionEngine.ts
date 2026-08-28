import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, productionTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export type ProductionJobType = "VIDEO_GEN" | "VOICE_GEN" | "LIP_SYNC" | "MUSIC_SFX_GEN";
export type ProductionJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ProductionJobPayload {
  projectId?: number;
  taskId?: number;
  prompt?: string;
  text?: string;
  videoUrl?: string;
  audioUrl?: string;
  voiceId?: string;
  model?: string;
  worldId?: string;
  [key: string]: unknown;
}

export interface ProductionJob {
  id: string;
  projectId?: number;
  type: ProductionJobType;
  status: ProductionJobStatus;
  progress: number;
  payload: ProductionJobPayload;
  providerJobId?: string | null;
  output?: Record<string, unknown> | string | null;
  error?: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const jobsStore = new Map<string, ProductionJob>();
let workerInterval: NodeJS.Timeout | null = null;
let isProcessingQueue = false;

const REPLICATE_PREDICTIONS_ENDPOINT = "https://api.replicate.com/v1/predictions";
const DEEPGRAM_TTS_ENDPOINT = "https://api.deepgram.com/v1/speak";
const POLLING_INTERVAL_MS = 3_000;
const MAX_POLLING_ATTEMPTS = 60;
const HTTP_TIMEOUT_MS = 20_000;

function getAudioDir(): string {
  const audioDir = path.resolve(process.cwd(), "uploads", "audio");
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  return audioDir;
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
    for (const key of ["video", "video_url", "url", "output", "synced_video", "audio", "audio_url"]) {
      const val = record[key];
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
  }
  return undefined;
}

async function pollReplicatePrediction(predictionId: string, apiToken: string): Promise<string> {
  const pollingUrl = `${REPLICATE_PREDICTIONS_ENDPOINT}/${predictionId}`;

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
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
      const errText = await pollResponse.text().catch(() => "");
      throw new Error(`Replicate polling failed (${pollResponse.status}): ${errText}`);
    }

    const prediction = (await pollResponse.json()) as {
      status: string;
      output?: unknown;
      error?: string | null;
    };

    if (prediction.status === "succeeded") {
      const mediaUrl = extractMediaUrl(prediction.output);
      if (!mediaUrl) {
        throw new Error("Prediction status is 'succeeded' but returned no valid media URL.");
      }
      return mediaUrl;
    }

    if (prediction.status === "failed") {
      throw new Error(`Prediction failed: ${prediction.error || "Unknown provider failure"}`);
    }

    if (prediction.status === "canceled") {
      throw new Error("Prediction was canceled by provider.");
    }
  }

  throw new Error(`Prediction ${predictionId} timed out after ${MAX_POLLING_ATTEMPTS * 3} seconds.`);
}

async function executeVideoGen(payload: ProductionJobPayload): Promise<{ videoUrl: string; providerJobId: string }> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN environment variable is not configured.");

  const version = process.env.REPLICATE_VIDEO_MODEL_VERSION?.trim();
  if (!version) throw new Error("REPLICATE_VIDEO_MODEL_VERSION environment variable is not configured.");

  const prompt = payload.prompt?.trim();
  if (!prompt) throw new Error("Prompt is required for VIDEO_GEN.");

  const response = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version,
      input: { prompt },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Replicate Video creation failed (${response.status}): ${errorText}`);
  }

  const prediction = (await response.json()) as { id: string; status: string; output?: unknown };
  if (!prediction?.id) throw new Error("Replicate Video API did not return a prediction ID.");

  let videoUrl: string;
  if (prediction.status === "succeeded") {
    videoUrl = extractMediaUrl(prediction.output) || (await pollReplicatePrediction(prediction.id, token));
  } else {
    videoUrl = await pollReplicatePrediction(prediction.id, token);
  }

  return { videoUrl, providerJobId: prediction.id };
}

async function executeVoiceGen(payload: ProductionJobPayload): Promise<{ audioUrl: string; fileSize: number }> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY environment variable is not configured.");

  const text = (payload.text || payload.prompt)?.toString().trim();
  if (!text) throw new Error("Text is required for VOICE_GEN.");

  const model = payload.model?.trim() || process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-asteria-en";
  const url = `${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(model)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
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
  if (!buffer || buffer.length === 0) throw new Error("Deepgram TTS returned 0 bytes.");

  const filename = `job_voice_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp3`;
  const filePath = path.join(getAudioDir(), filename);
  fs.writeFileSync(filePath, buffer);

  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size === 0) throw new Error("Failed to write audio file to disk.");

  return { audioUrl: `/api/voice/audio/${filename}`, fileSize: stats.size };
}

async function executeLipSync(payload: ProductionJobPayload): Promise<{ syncedVideoUrl: string; providerJobId: string }> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN environment variable is not configured.");

  const version = process.env.REPLICATE_LIPSYNC_MODEL_VERSION?.trim();
  if (!version) throw new Error("REPLICATE_LIPSYNC_MODEL_VERSION environment variable is not configured.");

  const videoUrl = payload.videoUrl?.trim();
  const audioUrl = payload.audioUrl?.trim();
  if (!videoUrl || !audioUrl) throw new Error("Both videoUrl and audioUrl are required for LIP_SYNC.");

  const response = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=5",
    },
    body: JSON.stringify({
      version,
      input: {
        face: videoUrl,
        input_audio: audioUrl,
      },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Replicate LipSync creation failed (${response.status}): ${errorText}`);
  }

  const prediction = (await response.json()) as { id: string; status: string; output?: unknown };
  if (!prediction?.id) throw new Error("Replicate LipSync API did not return a prediction ID.");

  const syncedVideoUrl = await pollReplicatePrediction(prediction.id, token);
  return { syncedVideoUrl, providerJobId: prediction.id };
}

async function executeMusicSfxGen(payload: ProductionJobPayload): Promise<{ audioUrl: string; prompt: string }> {
  const prompt = payload.prompt?.trim() || "Cinematic orchestral score with subtle environmental sound effects";
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();

  // If Deepgram is available, generate ambient vocalization/speech cue, or synthesized audio file
  if (apiKey) {
    const model = "aura-asteria-en";
    const response = await fetch(`${DEEPGRAM_TTS_ENDPOINT}?model=${model}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `[Soundtrack and Ambient Theme]: ${prompt}` }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (response.ok) {
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.length > 0) {
        const filename = `job_sfx_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp3`;
        const filePath = path.join(getAudioDir(), filename);
        fs.writeFileSync(filePath, buf);
        return { audioUrl: `/api/voice/audio/${filename}`, prompt };
      }
    }
  }

  throw new Error("Failed to generate MUSIC_SFX_GEN: active audio provider is not reachable.");
}

export function createProductionJob(type: ProductionJobType, payload: ProductionJobPayload, maxRetries = 3): ProductionJob {
  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const job: ProductionJob = {
    id: jobId,
    projectId: payload.projectId,
    type,
    status: "pending",
    progress: 0,
    payload,
    retryCount: 0,
    maxRetries,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobsStore.set(jobId, job);
  logger.info({ jobId, type }, "Production job created and queued");

  setImmediate(() => {
    void processNextQueuedJob();
  });

  return job;
}

export function getProductionJob(jobId: string): ProductionJob | undefined {
  return jobsStore.get(jobId);
}

export function listProductionJobs(projectId?: number): ProductionJob[] {
  const all = Array.from(jobsStore.values());
  if (projectId !== undefined) {
    return all.filter((j) => j.projectId === projectId);
  }
  return all;
}

export async function processNextQueuedJob(): Promise<ProductionJob | null> {
  if (isProcessingQueue) return null;

  const job = Array.from(jobsStore.values()).find((j) => j.status === "pending");
  if (!job) return null;

  // Never re-execute a completed job
  if (job.status === "completed") return null;

  isProcessingQueue = true;
  job.status = "processing";
  job.startedAt = new Date();
  job.updatedAt = new Date();
  job.progress = 15;

  logger.info({ jobId: job.id, type: job.type, retryCount: job.retryCount }, "Processing production job");

  try {
    // 1. Sync status with database task if linked
    if (job.payload.taskId && typeof job.payload.taskId === "number") {
      try {
        await db.update(productionTasksTable).set({ status: "processing" }).where(eq(productionTasksTable.id, job.payload.taskId));
      } catch (dbErr) {
        logger.warn({ err: dbErr }, "Could not update DB task status to processing");
      }
    }

    job.progress = 35;

    // 2. Execute by Job Type
    switch (job.type) {
      case "VIDEO_GEN": {
        const result = await executeVideoGen(job.payload);
        job.providerJobId = result.providerJobId;
        job.output = { videoUrl: result.videoUrl };
        break;
      }
      case "VOICE_GEN": {
        const result = await executeVoiceGen(job.payload);
        job.output = { audioUrl: result.audioUrl, fileSize: result.fileSize };
        break;
      }
      case "LIP_SYNC": {
        const result = await executeLipSync(job.payload);
        job.providerJobId = result.providerJobId;
        job.output = { syncedVideoUrl: result.syncedVideoUrl };
        break;
      }
      case "MUSIC_SFX_GEN": {
        const result = await executeMusicSfxGen(job.payload);
        job.output = { audioUrl: result.audioUrl, prompt: result.prompt };
        break;
      }
      default:
        throw new Error(`Unsupported job type: ${(job as ProductionJob).type}`);
    }

    // 3. Mark completed
    job.status = "completed";
    job.progress = 100;
    job.completedAt = new Date();
    job.updatedAt = new Date();
    job.error = null;

    if (job.payload.taskId && typeof job.payload.taskId === "number") {
      try {
        await db.update(productionTasksTable).set({ status: "completed" }).where(eq(productionTasksTable.id, job.payload.taskId));
      } catch (dbErr) {
        logger.warn({ err: dbErr }, "Could not update DB task status to completed");
      }
    }

    logger.info({ jobId: job.id, type: job.type }, "Production job completed successfully");
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Unknown execution error";
    job.error = errMessage;
    job.updatedAt = new Date();

    if (job.retryCount < job.maxRetries) {
      job.retryCount += 1;
      job.status = "pending";
      job.progress = 0;
      logger.warn({ jobId: job.id, retryCount: job.retryCount, maxRetries: job.maxRetries, err: errMessage }, "Job failed, re-queued for retry");
    } else {
      job.status = "failed";
      job.progress = 0;
      job.completedAt = new Date();

      if (job.payload.taskId && typeof job.payload.taskId === "number") {
        try {
          await db.update(productionTasksTable).set({ status: "failed" }).where(eq(productionTasksTable.id, job.payload.taskId));
        } catch (dbErr) {
          logger.warn({ err: dbErr }, "Could not update DB task status to failed");
        }
      }

      logger.error({ jobId: job.id, err: errMessage }, "Production job permanently failed");
    }
  } finally {
    isProcessingQueue = false;

    // Process next queued job if one exists
    setImmediate(() => {
      void processNextQueuedJob();
    });
  }

  return job;
}

export function startProductionWorker(pollIntervalMs = 5000): void {
  if (workerInterval) return;
  logger.info("Starting background production worker...");
  workerInterval = setInterval(() => {
    void processNextQueuedJob();
  }, pollIntervalMs);
}

export function stopProductionWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Stopped background production worker.");
  }
}
