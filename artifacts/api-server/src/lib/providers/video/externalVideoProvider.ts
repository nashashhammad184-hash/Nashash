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
// KAYAN-TASK-73D: persist downloaded video to the active storage provider.
import { persistVideoFile } from "../../storage/persist";

const PROVIDER_KIND = (process.env.VIDEO_EXTERNAL_KIND || "wavespeed").toLowerCase();
const MAX_COST_USD = parseFloat(process.env.MAX_VIDEO_COST_USD || "0.30");

function getProvider() {
  if (PROVIDER_KIND === "wavespeed") return waveSpeedProvider;
  if (PROVIDER_KIND === "mock") return mockProvider;
  throw new Error(`Unknown VIDEO_EXTERNAL_KIND: ${PROVIDER_KIND}`);
}

/**
 * KAYAN-CINEMA-03A: WaveSpeed Hunyuan 1.5 accepts only duration in {5, 8}.
 * Any other value (undefined, sub-5, >8, non-numeric) → 5.
 * Pure function — no I/O. Only applied when provider.name === "wavespeed".
 */
export function normalizeWaveSpeedDuration(raw: unknown): number {
  const n = Number(raw);
  if (n === 5 || n === 8) return n;
  return 5;
}

export async function runExternalVideoJob(job: {
  payload: any;
  queueJobId?: string;
  resumeProviderJobId?: string;
  onSubmitted?: (providerJobId: string) => Promise<void>;
}): Promise<VideoProviderResult> {
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
  // KAYAN-CINEMA-01: accept both snake_case and camelCase (pipeline sends camelCase).
  const _refB64 = p.reference_image_base64 ?? p.referenceImageBase64;
  if (!_refB64 || typeof _refB64 !== "string" || _refB64.length < 64) {
    const err: any = new Error(
      "I2V_REFERENCE_IMAGE_REQUIRED: reference_image_base64/referenceImageBase64 is required for external I2V",
    );
    err.category = "INVALID_INPUT";
    throw err;
  }

  // KAYAN-CINEMA-03A: resolve duration with provider-aware normalization.
  // WaveSpeed Hunyuan 1.5 accepts only {5, 8}; other providers (mock) are
  // untouched. Must run BEFORE estimateCost so cost guard uses real price.
  const rawDuration = p.duration_seconds ?? p.durationSeconds ?? 5;
  const resolvedDuration = provider.name === "wavespeed"
    ? normalizeWaveSpeedDuration(rawDuration)
    : (typeof rawDuration === "number" && rawDuration > 0 ? rawDuration : 5);
  if (provider.name === "wavespeed" && Number(rawDuration) !== resolvedDuration) {
    console.log(
      `[external:wavespeed] duration normalized: requested=${JSON.stringify(rawDuration)} → sent=${resolvedDuration}`,
    );
  }
  const payload: VideoPayload = {
    task: "i2v",
    prompt: p.prompt,
    seed: p.seed ?? 123,
    resolution: p.resolution ?? "480p",
    durationSeconds: resolvedDuration,
    fps: p.fps ?? 16,
    aspectRatio: p.aspect_ratio ?? p.aspectRatio ?? "16:9",
    numFrames: p.num_frames ?? p.numFrames,
    negativePrompt: p.negative_prompt ?? p.negativePrompt,
    referenceImageBase64: p.reference_image_base64 ?? p.referenceImageBase64,
    steps: p.steps,
  };

  // KAYAN-CINEMA-03D: resume path — if caller already has a providerJobId
  // (e.g. recovered after worker crash), skip submit/cost-guard entirely and
  // go straight to polling. Never submit a second time.
  let providerJobId: string;
  if (job.resumeProviderJobId && job.resumeProviderJobId.trim().length > 0) {
    providerJobId = job.resumeProviderJobId;
    console.log(
      `[external:${provider.name}] RESUMING poll for existing providerJobId=${providerJobId} (no submit)`,
    );
  } else {
    // --- Cost guard (pre-submit only) ---
    const estCost = await provider.estimateCost(payload);
    if (estCost > MAX_COST_USD) {
      const err: any = new Error(
        `Cost guard: estimated $${estCost.toFixed(3)} exceeds MAX_VIDEO_COST_USD=$${MAX_COST_USD}`,
      );
      err.category = "BILLING" as const;
      throw err;
    }

    // --- Submit ---
    const submitted = await provider.submit(payload);
    providerJobId = submitted.providerJobId;
    console.log(`[external:${provider.name}] submitted job ${providerJobId}, est $${estCost.toFixed(3)}`);

    // KAYAN-CINEMA-03D: persist providerJobId IMMEDIATELY (before any poll).
    // If persistence fails AFTER provider accepted, we CANNOT retry safely —
    // the provider may charge us again. Mark as SUBMIT_UNCERTAIN.
    if (job.onSubmitted) {
      try {
        await job.onSubmitted(providerJobId);
        console.log(
          `[external:${provider.name}] onSubmitted persisted providerJobId=${providerJobId}`,
        );
      } catch (persistErr: any) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        const err: any = new Error(
          `SUBMIT_UNCERTAIN: provider accepted job ${providerJobId} but persistence failed: ${msg}`,
        );
        err.category = "SUBMIT_UNCERTAIN";
        err.providerJobId = providerJobId;
        err.submitUncertain = true;
        throw err;
      }
    } else if (job.queueJobId) {
      // Legacy path (queue-worker): persist via gpu_jobs.
      try {
        await GpuQueueService.setProviderJobId(job.queueJobId, provider.name, providerJobId);
        console.log(
          `[external:${provider.name}] persisted providerRequestId for queue job ${job.queueJobId}`,
        );
      } catch (persistErr: any) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        const err: any = new Error(
          `SUBMIT_UNCERTAIN: provider accepted job ${providerJobId} but gpu_jobs persistence failed: ${msg}`,
        );
        err.category = "SUBMIT_UNCERTAIN";
        err.providerJobId = providerJobId;
        err.submitUncertain = true;
        throw err;
      }
    } else {
      console.warn(
        `[external:${provider.name}] no onSubmitted/queueJobId — providerJobId NOT persisted (dev/test path)`,
      );
    }
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
  // KAYAN-TASK-73D: persist the freshly-downloaded file through the storage
  // layer. Under STORAGE_PROVIDER=local this is a no-op URL build (the file
  // is already at uploads/videos/<basename>). Under R2 the file is uploaded.
  // We also encode the storage URL into remote_path so generateVideoKayanGpu
  // and queue-worker can surface it as the canonical videoUrl.
  let storageUrl: string | undefined;
  try {
    const persisted = await persistVideoFile(result.mp4_path);
    storageUrl = persisted.url;
  } catch (persistErr) {
    // Persistence failure must fail the job — do not claim success without
    // a durable URL under the configured provider.
    const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
    const err: any = new Error(`[external:${provider.name}] storage persist failed for ${result.mp4_path}: ${msg}`);
    err.category = "PERMANENT";
    throw err;
  }
  return { ...result, remote_path: storageUrl };
}
