/**
 * VideoProvider interface — abstraction for video generation providers.
 *
 * Implementations:
 *   - KayanGpuVideoProvider (existing GPU worker via SSH tunnel)
 *   - WaveSpeedVideoProvider (HunyuanVideo 1.5 I2V via WaveSpeedAI API)
 *
 * Selected at runtime via VIDEO_PROVIDER env var.
 */

export type VideoTask = "i2v" | "t2v";

export interface VideoPayload {
  task: VideoTask;
  prompt: string;
  seed?: number;
  resolution?: string;
  durationSeconds?: number;
  fps?: number;
  aspectRatio?: string;
  numFrames?: number;
  negativePrompt?: string;
  referenceImageBase64?: string;
  steps?: number;
}

export interface VideoProviderResult {
  mp4_path: string;
  remote_path?: string;
  duration: number;
  worker_jid: string;
  probe: unknown;
  provider: string;
}

export type ErrorCategory =
  | "TRANSIENT"
  | "PERMANENT"
  | "AUTH"
  | "BILLING"
  | "CONTENT_POLICY"
  | "INVALID_INPUT"
  | "PROVIDER_TIMEOUT";

export interface VideoProvider {
  readonly name: string;

  /** Submit a job. Returns providerJobId that must be persisted immediately. */
  submit(payload: VideoPayload): Promise<{ providerJobId: string }>;

  /** Poll once. Returns state without downloading. */
  poll(providerJobId: string): Promise<{
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    error?: string;
  }>;

  /** Download completed output to local disk. */
  download(providerJobId: string, outputDir: string): Promise<VideoProviderResult>;

  /** Classify an error for retry decisions. */
  classifyError(err: unknown): ErrorCategory;

  /** Estimate cost in USD before submitting. */
  estimateCost(payload: VideoPayload): Promise<number>;
}
