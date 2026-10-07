/**
 * External video provider dispatcher.
 *
 * Reads VIDEO_PROVIDER env var. Only "external" reaches here.
 * Inside "external", the specific provider is chosen by VIDEO_EXTERNAL_KIND.
 * Currently: "wavespeed" (default).
 *
 * Cost guard enforces MAX_VIDEO_COST_USD before any submit call.
 */
import type { VideoPayload, VideoProviderResult } from "./types";
import { waveSpeedProvider } from "./waveSpeedProvider";
import { mockProvider } from "./mockProvider";
import { GpuQueueService } from "../../services/GpuQueueService";

const PROVIDER_KIND = (process.env.VIDEO_EXTERNAL_KIND || "wavespeed").toLowerCase();
const MAX_COST_USD = parseFloat(process.env.MAX_VIDEO_COST_USD || "0.30");

function getProvider() {
  if (PROVIDER_KIND === "wavespeed") return waveSpeedProvider;
  if (PROVIDER_KIND === "mock") return mockProvider;
  throw new Error(`Unknown VIDEO_EXTERNAL_KIND: ${PROVIDER_KIND}`);
}

export async function runExternalVideoJob(job: { payload: any; queueJobId?: string }): Promise<VideoProviderResult> {
  const p = job.payload || {};
  const provider = getProvider();

  // KAYAN-TASK-22: external provider (WaveSpeed) supports I2V only.
  // Reject anything that is not explicitly task="i2v" — no silent t2v fallback.
  if (p.task !== "i2v") {
    const err: any = new Error(
      "VIDEO_I2V_REQUIRED: external provider requires task='i2v' (received " +
      JSON.stringify(p.task) + ")",
    );
    err.category = "INVALID_INPUT";
    throw err;
  }
  if (!p.reference_image_base64 || typeof p.reference_image_base64 !== "string"
      || p.reference_image_base64.length < 64) {
    const err: any = new Error(
      "I2V_REFERENCE_IMAGE_REQUIRED: reference_image_base64 is required for external I2V",
    );
    err.category = "INVALID_INPUT";
    throw err;
  }

  const payload: VideoPayload = {
    task: "i2v",
    prompt: p.prompt,
    seed: p.seed ?? 123,
    resolution: p.resolution ?? "480p",
    durationSeconds: p.duration_seconds ?? p.durationSeconds ?? 5,
    fps: p.fps ?? 16,
    aspectRatio: p.aspect_ratio ?? p.aspectRatio ?? "16:9",
    numFrames: p.num_frames ?? p.numFrames,
    negativePrompt: p.negative_prompt ?? p.negativePrompt,
    referenceImageBase64: p.reference_image_base64 ?? p.referenceImageBase64,
    steps: p.steps,
  };

  // --- Cost guard ---
  const estCost = await provider.estimateCost(payload);
  if (estCost > MAX_COST_USD) {
    const err: any = new Error(
      `Cost guard: estimated $${estCost.toFixed(3)} exceeds MAX_VIDEO_COST_USD=$${MAX_COST_USD}`,
    );
    err.category = "BILLING" as const;
    throw err;
  }

  // --- Submit ---
  const { providerJobId } = await provider.submit(payload);
  console.log(`[external:${provider.name}] submitted job ${providerJobId}, est $${estCost.toFixed(3)}`);

  // KAYAN-TASK-31: persist providerRequestId BEFORE polling.
  // If DB persistence fails, refuse to poll so the job cannot silently
  // continue without recoverable state.
  if (job.queueJobId) {
    await GpuQueueService.setProviderJobId(
      job.queueJobId,
      provider.name,
      providerJobId,
    );
    console.log(
      `[external:${provider.name}] persisted providerRequestId for queue job ${job.queueJobId}`,
    );
  } else {
    console.warn(
      `[external:${provider.name}] no queueJobId provided — providerRequestId NOT persisted (dev/test path)`,
    );
  }

  // --- Poll ---
  const deadline = Date.now() + 30 * 60 * 1000;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    const st = await provider.poll(providerJobId);
    lastStatus = st.status;
    if (st.status === "completed") break;
    if (st.status === "failed" || st.status === "cancelled") {
      const err: any = new Error(
        `[external:${provider.name}] job ${providerJobId} ${st.status}: ${st.error || ""}`,
      );
      err.category = provider.classifyError(err);
      throw err;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (lastStatus !== "completed") {
    const err: any = new Error(`[external:${provider.name}] timeout after ${providerJobId}`);
    err.category = "PROVIDER_TIMEOUT";
    throw err;
  }

  // --- Download ---
  const outputDir =
    process.env.NASHASH_VIDEO_DIR ||
    require("node:path").resolve(process.cwd(), "uploads", "videos");
  const result = await provider.download(providerJobId, outputDir);
  return result;
}
