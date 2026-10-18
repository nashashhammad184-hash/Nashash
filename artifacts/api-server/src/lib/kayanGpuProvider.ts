/**
 * KayanGPU Provider — sole video provider.
 * Real Worker: /opt/kayangpu/api/main.py on A10G, accessed via SSH tunnel 127.0.0.1:8080.
 * Auth: X-API-Key header. Worker is async: POST /jobs/video -> poll /jobs/{id} -> scp MP4.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { GpuQueueService } from "./services/GpuQueueService";

export interface VideoGenRequest {
  prompt: string;
  /** KAYAN-TASK-16 — invoked as soon as the queue accepts the job. */
  onEnqueued?: (queueJobId: string) => void | Promise<void>;
  durationSeconds?: number;
  seed?: number;
  resolution?: string;
  steps?: number;
  model?: string;
  // KAYAN-FACE-ROOT-02 — I2V pathway
  task?: "t2v" | "i2v";
  referenceImageBase64?: string | null;
  negativePrompt?: string;
  fps?: number;
  numFrames?: number;
  aspectRatio?: string;
}

export interface LipSyncRequest {
  videoPath: string;
  audioPath: string;
  /** KAYAN-TASK-16 — same contract as VideoGenRequest.onEnqueued. */
  onEnqueued?: (queueJobId: string) => void | Promise<void>;
}

export interface KayanGpuResult {
  success: true;
  videoPath: string;
  videoUrl: string;
  jobId: string;
  provider: string;
}

const GPU_WORKER_URL = (process.env.GPU_WORKER_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const GPU_WORKER_TOKEN = process.env.GPU_WORKER_TOKEN || "";
const GPU_WORKER_TIMEOUT = parseInt(process.env.GPU_WORKER_TIMEOUT || "1800000", 10);
const GPU_POLL_INTERVAL = parseInt(process.env.GPU_POLL_INTERVAL || "5000", 10);

const GPU_SSH_KEY = process.env.GPU_SSH_KEY || path.join(process.env.HOME || "/home/ubuntu", ".ssh/kayan_gpu");
const GPU_SSH_TARGET = process.env.GPU_SSH_TARGET || "ubuntu@127.0.0.1";
const NASHASH_VIDEO_DIR = process.env.NASHASH_VIDEO_DIR || path.resolve(process.cwd(), "uploads", "videos");

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (GPU_WORKER_TOKEN) headers["X-API-Key"] = GPU_WORKER_TOKEN;
  return headers;
}

async function gpuJson(
  pathname: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<any> {
  const url = `${GPU_WORKER_URL}${pathname}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: buildHeaders(),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? GPU_WORKER_TIMEOUT),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`KayanGPU ${pathname} failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }
  return response.json();
}

async function waitForJob(jobId: string, maxWaitMs = 30 * 60 * 1000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const job = await gpuJson(`/jobs/${jobId}`, { timeoutMs: 15000 });
    const status = job?.status;
    if (status === "completed") return job;
    if (status === "failed") throw new Error(`KayanGPU job ${jobId} failed: ${job.error || "unknown"}`);
    if (status === "cancelled") throw new Error(`KayanGPU job ${jobId} was cancelled`);
    await new Promise((r) => setTimeout(r, GPU_POLL_INTERVAL));
  }
  throw new Error(`KayanGPU job ${jobId} timed out after ${maxWaitMs}ms`);
}

async function fetchOutputFromGpu(remotePath: string, localName: string): Promise<string> {
  fs.mkdirSync(NASHASH_VIDEO_DIR, { recursive: true });
  const localPath = path.join(NASHASH_VIDEO_DIR, localName);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("scp", [
      "-i", GPU_SSH_KEY,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "ConnectTimeout=15",
      `${GPU_SSH_TARGET}:${remotePath}`,
      localPath,
    ]);
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", (e) => reject(new Error(`scp spawn failed: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`scp exited ${code}: ${err.slice(0, 400)}`));
    });
  });
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
    throw new Error(`scp produced missing or empty file at ${localPath}`);
  }
  return localPath;
}

export async function generateVideoKayanGpu(req: VideoGenRequest): Promise<KayanGpuResult> {
  // KAYAN 52741 — Video goes through GPU Queue.
  // KAYAN-FACE-ROOT-02: build payload for worker VideoJobRequest
  const task: "t2v" | "i2v" = req.task === "i2v" ? "i2v" : "t2v";
  if (task === "i2v") {
    if (!req.referenceImageBase64 || typeof req.referenceImageBase64 !== "string" || req.referenceImageBase64.length < 64) {
      throw new Error("i2v requires referenceImageBase64 (>=64 chars)");
    }
    const dur = req.durationSeconds ?? 5;
    if (!(dur > 0 && dur <= 10)) throw new Error(`durationSeconds out of range: ${dur}`);
    if (req.numFrames != null && (req.numFrames - 1) % 4 !== 0) {
      throw new Error(`numFrames=${req.numFrames} violates (n-1)%4==0`);
    }
  }
  const payload: Record<string, unknown> = {
    prompt: req.prompt,
    seed: req.seed ?? 123,
    resolution: req.resolution ?? '480p',
    steps: req.steps ?? (task === "i2v" ? 8 : 4),
    task,
  };
  if (task === "i2v") {
    payload.reference_image_base64 = req.referenceImageBase64;
    payload.duration_seconds = req.durationSeconds ?? 5;
    payload.fps = req.fps ?? 16;
    payload.aspect_ratio = req.aspectRatio ?? "16:9";
    if (req.numFrames != null) payload.num_frames = req.numFrames;
    // KAYAN-TASK-11 (verified 2026-09-27): negative_prompt IS now threaded
    // through to LightX2V's pipe.generate(negative_prompt=...) for both t2v and
    // i2v. Worker: /opt/kayangpu/api/main.py lines 286, 296 (see commit history).
    // LightX2V signature: LightX2VPipeline.generate(..., negative_prompt=None, ...)
    // and pipeline.py:395/432 forwards it into the text-encoder input dict.
    // Empty/whitespace strings are converted to None to keep default behavior.
    if (req.negativePrompt) payload.negative_prompt = req.negativePrompt;
  }
  const enq = await GpuQueueService.enqueue('VIDEO_JOB', payload);
  // KAYAN-TASK-19-FIX-B+ — persist provider job id BEFORE polling.
  // Mirrors the same contract already implemented in generateLipSyncKayanGpu.
  if (typeof req.onEnqueued === 'function') {
    try { await req.onEnqueued(enq.id); } catch { /* best-effort */ }
  }

  // poll our own queue until COMPLETED/FAILED
  const POLL_MS = 2000;
  const MAX_MS = 4 * 60 * 60 * 1000;
  const deadline = Date.now() + MAX_MS;
  let last: any = null;
  while (Date.now() < deadline) {
    const j = await GpuQueueService.getJob(enq.id);
    if (!j) throw new Error(`queue job ${enq.id} disappeared`);
    last = j;
    if (j.status === 'COMPLETED') {
      const r: any = j.result || {};
      // KAYAN-TASK-73D: prefer the storage URL when the provider recorded
      // one (remote_path is set by externalVideoProvider after persisting).
      // Falls back to /uploads/videos/<basename> for legacy KayanGPU path.
      const videoUrl = typeof r.remote_path === "string" && r.remote_path.length > 0
        ? r.remote_path
        : `/uploads/videos/${require('node:path').basename(r.mp4_path || '')}`;
      return {
        success: true,
        videoPath: r.mp4_path,
        videoUrl,
        jobId: r.worker_jid || enq.id,
        provider: 'kayangpu-queue',
      };
    }
    if (j.status === 'FAILED') {
      throw new Error(`video job ${enq.id} FAILED: ${j.error || 'unknown'}`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`video job ${enq.id} timed out; last status ${last?.status}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function __legacyGenerateVideoKayanGpu(req: VideoGenRequest): Promise<KayanGpuResult> {
  const created = await gpuJson("/jobs/video", {
    method: "POST",
    body: {
      prompt: req.prompt,
      seed: req.seed ?? 123,
      resolution: req.resolution ?? "480p",
      steps: req.steps ?? 4,
    },
    timeoutMs: 30000,
  });
  const jobId: string = created?.job_id;
  if (!jobId) throw new Error("KayanGPU /jobs/video returned no job_id");

  const job = await waitForJob(jobId);
  const remotePath: string = job?.output_path;
  if (!remotePath) throw new Error(`KayanGPU job ${jobId} completed without output_path`);

  const fileName = `gpu_${jobId}.mp4`;
  const localPath = await fetchOutputFromGpu(remotePath, fileName);

  return {
    success: true,
    videoPath: localPath,
    videoUrl: `/uploads/videos/${fileName}`,
    jobId,
    provider: "kayangpu",
  };
}

export async function generateLipSyncKayanGpu(req: LipSyncRequest): Promise<KayanGpuResult> {
  // KAYAN 74216 — LipSync goes through the same GPU Queue (LIP_SYNC_JOB).
  const enq = await GpuQueueService.enqueue('LIP_SYNC_JOB', {
    video_path: req.videoPath,
    audio_path: req.audioPath,
  });
  // KAYAN-TASK-16 — persist the queue job id immediately.
  if (typeof req.onEnqueued === 'function') {
    try { await req.onEnqueued(enq.id); } catch { /* best-effort */ }
  }

  const POLL_MS = 2000;
  const MAX_MS = 2 * 60 * 60 * 1000;
  const deadline = Date.now() + MAX_MS;
  let last: any = null;
  while (Date.now() < deadline) {
    const j = await GpuQueueService.getJob(enq.id);
    if (!j) throw new Error(`lipsync queue job ${enq.id} disappeared`);
    last = j;
    if (j.status === 'COMPLETED') {
      const r: any = j.result || {};
      // KAYAN-TASK-07 — no_face_in_video is a FAILURE, NOT a successful skip.
      // Real Lip Sync success requires an actual synced MP4 asset that differs
      // from the input video. Worker diagnostic is preserved on the error.
      if (r.skipped && r.reason === 'no_face_in_video') {
        const err: any = new Error(
          `lipsync: worker reported no_face_in_video — Lip Sync did not run ` +
          `(worker_jid=${r.worker_jid || 'unknown'})`,
        );
        err.code = 'LIPSYNC_NO_FACE';
        err.diagnostic = { note: r.note, worker_jid: r.worker_jid, enqId: enq.id };
        throw err;
      }
      const mp4 = r.mp4_path;
      if (!mp4) throw new Error(`lipsync job ${enq.id} completed without mp4_path`);
      // KAYAN-TASK-07 — real output must differ from input video.
      try {
        const fs = require('node:fs');
        if (!fs.existsSync(mp4)) throw new Error(`lipsync output missing at ${mp4}`);
        const st = fs.statSync(mp4);
        if (!st.isFile() || st.size === 0) throw new Error(`lipsync output empty at ${mp4}`);
        const inAbs = require('node:path').resolve(req.videoPath);
        const outAbs = require('node:path').resolve(mp4);
        if (inAbs === outAbs) {
          const err: any = new Error(`lipsync output equals input video (${mp4}) — no actual sync performed`);
          err.code = 'LIPSYNC_OUTPUT_IS_INPUT';
          throw err;
        }
      } catch (e: any) {
        if (e?.code === 'LIPSYNC_OUTPUT_IS_INPUT') throw e;
        // Re-wrap missing/empty cases with clear code
        const err: any = new Error(e?.message || String(e));
        err.code = 'LIPSYNC_OUTPUT_INVALID';
        throw err;
      }
      return {
        success: true,
        videoPath: mp4,
        videoUrl: `/uploads/videos/${require('node:path').basename(mp4)}`,
        jobId: r.worker_jid || enq.id,
        provider: 'kayangpu-queue-lipsync',
      };
    }
    if (j.status === 'FAILED') {
      throw new Error(`lipsync job ${enq.id} FAILED: ${j.error || 'unknown'}`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`lipsync job ${enq.id} timed out; last status ${last?.status}`);
}

export async function isKayanGpuAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${GPU_WORKER_URL}/health`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
