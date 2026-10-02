/**
 * WaveSpeedVideoProvider — HunyuanVideo 1.5 I2V via WaveSpeedAI.
 *
 * Endpoint (per docs):
 *   POST https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-video-1.5/image-to-video
 *
 * Env vars:
 *   WAVESPEED_API_KEY
 *   WAVESPEED_SUBMIT_URL (optional override)
 *   WAVESPEED_STATUS_URL (optional override, must include {id} placeholder)
 *   WAVESPEED_RESULT_URL (optional override, must include {id} placeholder)
 *
 * Response shape is verified after first live call. Adjust parseResponse()
 * if WaveSpeed returns a different schema.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  VideoProvider,
  VideoPayload,
  VideoProviderResult,
  ErrorCategory,
} from "./types";

const pExec = promisify(execFile);

const API_KEY = process.env.WAVESPEED_API_KEY || "";
const SUBMIT_URL =
  process.env.WAVESPEED_SUBMIT_URL ||
  "https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-video-1.5/image-to-video";
const STATUS_URL =
  process.env.WAVESPEED_STATUS_URL ||
  "https://api.wavespeed.ai/api/v3/predictions/{id}/status";
const RESULT_URL =
  process.env.WAVESPEED_RESULT_URL ||
  "https://api.wavespeed.ai/api/v3/predictions/{id}";
const POLL_MS = 5000;
const MAX_WAIT_MS = 30 * 60 * 1000;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

function urlWithId(template: string, id: string): string {
  return template.replace("{id}", encodeURIComponent(id));
}

export class WaveSpeedVideoProvider implements VideoProvider {
  readonly name = "wavespeed";

  async estimateCost(payload: VideoPayload): Promise<number> {
    // WaveSpeed pricing (public, 2026-10): 480p=$0.02/s, 720p=$0.04/s
    const is720 = (payload.resolution || "480p").includes("720");
    const perSec = is720 ? 0.04 : 0.02;
    const dur = payload.durationSeconds ?? 5;
    return perSec * dur;
  }

  async submit(payload: VideoPayload): Promise<{ providerJobId: string }> {
    if (!API_KEY) throw new Error("WAVESPEED_API_KEY is not set");
    if (payload.task !== "i2v") {
      throw new Error("WaveSpeed adapter currently supports i2v only");
    }
    if (!payload.referenceImageBase64) {
      throw new Error("i2v requires referenceImageBase64");
    }

    const body: Record<string, unknown> = {
      prompt: payload.prompt,
      image: payload.referenceImageBase64,
      seed: payload.seed ?? 123,
      duration: payload.durationSeconds ?? 5,
      resolution: payload.resolution ?? "480p",
    };
    if (payload.negativePrompt) body.negative_prompt = payload.negativePrompt;

    const r = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    if (!r.ok) {
      throw Object.assign(
        new Error(`WaveSpeed submit HTTP ${r.status}: ${text.slice(0, 300)}`),
        { httpStatus: r.status, body: text },
      );
    }
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`WaveSpeed submit: invalid JSON: ${text.slice(0, 200)}`);
    }
    // WaveSpeed typically returns { data: { id: "..." } } or { id: "..." }
    const id: string | undefined = j?.data?.id || j?.id || j?.task_id;
    if (!id) {
      throw new Error(`WaveSpeed submit: no job id in response: ${text.slice(0, 300)}`);
    }
    return { providerJobId: id };
  }

  async poll(providerJobId: string): Promise<{
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    error?: string;
  }> {
    const r = await fetch(urlWithId(STATUS_URL, providerJobId), {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`WaveSpeed status HTTP ${r.status}`);
    const j: any = await r.json();
    const raw = (j?.data?.status || j?.status || "").toLowerCase();
    const map: Record<string, any> = {
      created: "queued",
      queued: "queued",
      pending: "queued",
      processing: "running",
      running: "running",
      completed: "completed",
      success: "completed",
      succeeded: "completed",
      failed: "failed",
      error: "failed",
      cancelled: "cancelled",
    };
    const status = map[raw] || "running";
    return { status, error: j?.data?.error || j?.error };
  }

  async download(
    providerJobId: string,
    outputDir: string,
  ): Promise<VideoProviderResult> {
    const r = await fetch(urlWithId(RESULT_URL, providerJobId), {
      headers: authHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`WaveSpeed result HTTP ${r.status}`);
    const j: any = await r.json();
    const videoUrl: string | undefined =
      j?.data?.outputs?.[0] ||
      j?.data?.output?.[0] ||
      j?.data?.video?.url ||
      j?.outputs?.[0] ||
      j?.output?.url;
    if (!videoUrl) {
      throw new Error(`WaveSpeed result: no video URL: ${JSON.stringify(j).slice(0, 300)}`);
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `ws_${providerJobId}.mp4`;
    const localPath = path.join(outputDir, fileName);
    const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!dl.ok) throw new Error(`WaveSpeed download HTTP ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
      throw new Error("WaveSpeed download: empty file");
    }
    const { stdout } = await pExec("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-show_entries", "stream=codec_type",
      "-of", "json",
      localPath,
    ]);
    const probe = JSON.parse(stdout);
    const duration = Number(probe?.format?.duration ?? 0);
    const hasVideo = (probe?.streams || []).some(
      (s: any) => s.codec_type === "video",
    );
    if (!(duration > 0) || !hasVideo) {
      throw new Error(`WaveSpeed ffprobe failed (dur=${duration}, hasVideo=${hasVideo})`);
    }
    return {
      mp4_path: localPath,
      remote_path: videoUrl,
      duration,
      worker_jid: providerJobId,
      probe,
      provider: "wavespeed-hunyuan-i2v",
    };
  }

  classifyError(err: any): ErrorCategory {
    const http = err?.httpStatus;
    if (http === 401 || http === 403) return "AUTH";
    if (http === 402) return "BILLING";
    if (http === 429) return "TRANSIENT";
    if (http === 400 || http === 422) {
      const body = String(err?.body || "").toLowerCase();
      if (body.includes("policy") || body.includes("content")) return "CONTENT_POLICY";
      return "INVALID_INPUT";
    }
    if (http >= 500) return "TRANSIENT";
    if (err?.name === "AbortError" || /timeout/i.test(String(err?.message))) {
      return "PROVIDER_TIMEOUT";
    }
    return "PERMANENT";
  }
}

export const waveSpeedProvider = new WaveSpeedVideoProvider();
