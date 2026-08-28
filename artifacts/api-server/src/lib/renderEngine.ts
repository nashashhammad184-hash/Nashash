import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger";

export type RenderJobStatus = "queued" | "processing" | "completed" | "failed";

export interface TimelineClipItem {
  id?: number | string;
  url?: string;
  path?: string;
  durationSeconds?: number;
  order?: number;
}

export interface RenderJobInput {
  projectId?: number;
  videoUrl?: string;
  videoPath?: string;
  audioUrl?: string;
  audioPath?: string;
  subtitlesUrl?: string;
  subtitlesText?: string;
  watermarkText?: string;
  clips?: TimelineClipItem[];
}

export interface RenderJob {
  id: string;
  projectId?: number;
  status: RenderJobStatus;
  progress: number;
  input: RenderJobInput;
  outputPath?: string;
  outputUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const renderJobsStore = new Map<string, RenderJob>();

function getStorageDir(subDir: "renders" | "temp"): string {
  const targetDir = path.resolve(process.cwd(), "uploads", subDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

async function resolveAssetToLocal(assetUrlOrPath: string, extension: string): Promise<string> {
  const trimmed = assetUrlOrPath.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const tempDir = getStorageDir("temp");
    const filename = `asset_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${extension}`;
    const localFilePath = path.join(tempDir, filename);

    logger.info({ url: trimmed }, "Downloading remote asset for render...");
    const response = await fetch(trimmed, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`Failed to download remote render asset: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error(`Downloaded asset from ${trimmed} is 0 bytes.`);
    }

    fs.writeFileSync(localFilePath, buffer);
    return localFilePath;
  }

  if (fs.existsSync(trimmed)) {
    return trimmed;
  }

  throw new Error(`Specified local render asset does not exist: ${trimmed}`);
}

function spawnFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    logger.info({ args }, "Spawning real FFmpeg process...");
    const ffmpegProcess = spawn("ffmpeg", ["-y", ...args]);
    let stdout = "";
    let stderr = "";

    ffmpegProcess.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    ffmpegProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpegProcess.on("error", (err) => {
      reject(new Error(`Failed to spawn FFmpeg binary: ${err.message}. Ensure ffmpeg is installed.`));
    });

    ffmpegProcess.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errorDetails = stderr.slice(-600) || stdout.slice(-600) || "Unknown FFmpeg error";
        reject(new Error(`FFmpeg exited with non-zero status code ${code}: ${errorDetails}`));
      }
    });
  });
}

export function createRenderJob(input: RenderJobInput): RenderJob {
  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const newJob: RenderJob = {
    id: jobId,
    projectId: input.projectId,
    status: "queued",
    progress: 0,
    input,
    createdAt: new Date(),
  };

  renderJobsStore.set(jobId, newJob);
  logger.info({ jobId }, "Created new real render job");

  // Trigger processing asynchronously in queue
  setImmediate(() => {
    void processRenderQueue();
  });

  return newJob;
}

export function getRenderJobStatus(jobId: string): RenderJob | undefined {
  return renderJobsStore.get(jobId);
}

export async function processRenderQueue(): Promise<void> {
  const queuedJob = Array.from(renderJobsStore.values()).find((j) => j.status === "queued");
  if (!queuedJob) return;

  queuedJob.status = "processing";
  queuedJob.startedAt = new Date();
  queuedJob.progress = 15;

  const rendersDir = getStorageDir("renders");
  const outputFileName = `render_${queuedJob.id}.mp4`;
  const finalOutputPath = path.join(rendersDir, outputFileName);
  const tempFilesToClean: string[] = [];

  try {
    const input = queuedJob.input;
    const ffmpegArgs: string[] = [];

    // Case 1: Timeline clips concatenation
    if (Array.isArray(input.clips) && input.clips.length > 0) {
      queuedJob.progress = 30;
      const sortedClips = [...input.clips].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const concatListLines: string[] = [];

      for (const clip of sortedClips) {
        const clipSource = clip.path || clip.url;
        if (!clipSource) continue;
        const localClipPath = await resolveAssetToLocal(clipSource, "mp4");
        tempFilesToClean.push(localClipPath);
        concatListLines.push(`file '${localClipPath.replace(/'/g, "'\\''")}'`);
      }

      if (concatListLines.length === 0) {
        throw new Error("No valid clips found in timeline for concatenation.");
      }

      const tempDir = getStorageDir("temp");
      const concatListFile = path.join(tempDir, `concat_${queuedJob.id}.txt`);
      fs.writeFileSync(concatListFile, concatListLines.join("\n"));
      tempFilesToClean.push(concatListFile);

      ffmpegArgs.push("-f", "concat", "-safe", "0", "-i", concatListFile, "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", finalOutputPath);
    }
    // Case 2: Video + Audio Merge / Re-encode
    else if (input.videoUrl || input.videoPath) {
      queuedJob.progress = 35;
      const rawVideo = input.videoPath || input.videoUrl!;
      const localVideoPath = await resolveAssetToLocal(rawVideo, "mp4");
      tempFilesToClean.push(localVideoPath);

      if (input.audioUrl || input.audioPath) {
        const rawAudio = input.audioPath || input.audioUrl!;
        const localAudioPath = await resolveAssetToLocal(rawAudio, "mp3");
        tempFilesToClean.push(localAudioPath);

        ffmpegArgs.push(
          "-i", localVideoPath,
          "-i", localAudioPath,
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c:v", "libx264",
          "-c:a", "aac",
          "-shortest",
          "-pix_fmt", "yuv420p",
          finalOutputPath
        );
      } else {
        ffmpegArgs.push("-i", localVideoPath, "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", finalOutputPath);
      }
    }
    // Case 3: Audio only -> generate video with black background
    else if (input.audioUrl || input.audioPath) {
      queuedJob.progress = 35;
      const rawAudio = input.audioPath || input.audioUrl!;
      const localAudioPath = await resolveAssetToLocal(rawAudio, "mp3");
      tempFilesToClean.push(localAudioPath);

      ffmpegArgs.push(
        "-f", "lavfi",
        "-i", "color=c=black:s=1280x720:r=30",
        "-i", localAudioPath,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-shortest",
        "-pix_fmt", "yuv420p",
        finalOutputPath
      );
    } else {
      throw new Error("No media inputs (video, audio, or timeline clips) provided for rendering.");
    }

    queuedJob.progress = 60;
    await spawnFfmpeg(ffmpegArgs);

    // Strict Validation: file exists & size > 0
    if (!fs.existsSync(finalOutputPath)) {
      throw new Error(`Render output file was not found on disk at: ${finalOutputPath}`);
    }

    const fileStats = fs.statSync(finalOutputPath);
    if (!fileStats.isFile() || fileStats.size === 0) {
      if (fs.existsSync(finalOutputPath)) fs.unlinkSync(finalOutputPath);
      throw new Error("Render process created a 0-byte invalid video file.");
    }

    queuedJob.status = "completed";
    queuedJob.progress = 100;
    queuedJob.outputPath = finalOutputPath;
    queuedJob.outputUrl = `/uploads/renders/${outputFileName}`;
    queuedJob.fileSize = fileStats.size;
    queuedJob.completedAt = new Date();

    logger.info({ jobId: queuedJob.id, fileSize: fileStats.size }, "Render job completed successfully");
  } catch (error) {
    queuedJob.status = "failed";
    queuedJob.progress = 0;
    queuedJob.error = error instanceof Error ? error.message : "Unknown render engine failure";
    queuedJob.completedAt = new Date();

    logger.error({ jobId: queuedJob.id, err: error }, "Render job execution failed");
  } finally {
    // Cleanup temporary intermediate files
    for (const tempFile of tempFilesToClean) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        // ignore cleanup errors
      }
    }

    // Process next item in queue if available
    setImmediate(() => {
      void processRenderQueue();
    });
  }
}
