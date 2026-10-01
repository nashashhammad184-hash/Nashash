/**
 * External Video Provider — fal.ai HunyuanVideo 1.5 I2V
 *
 * Selected when VIDEO_PROVIDER=external in .env.
 * KayanGPU remains default (VIDEO_PROVIDER=kayangpu or unset).
 *
 * This module implements the SAME contract as queue-worker.runVideoJob:
 *   input:  job { payload }  (payload.reference_image_base64, prompt, task='i2v', ...)
 *   output: { mp4_path, remote_path, duration, worker_jid, probe, provider }
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExec = promisify(execFile);

const FAL_KEY = process.env.EXTERNAL_VIDEO_API_KEY || "";
const FAL_SUBMIT_URL =
  process.env.EXTERNAL_VIDEO_SUBMIT_URL ||
  "https://queue.fal.run/fal-ai/hunyuan-video-v1.5/image-to-video";
const FAL_STATUS_BASE =
  process.env.EXTERNAL_VIDEO_STATUS_BASE ||
  "https://queue.fal.run/fal-ai/hunyuan-video-v1.5/requests";
const NASHASH_VIDEO_DIR =
  process.env.NASHASH_VIDEO_DIR ||
  path.resolve(process.cwd(), "uploads", "videos");
const POLL_MS = 5000;
const MAX_WAIT_MS = 30 * 60 * 1000;

function classifyHttp(code: number): string {
  if (code === 401 || code === 403) return "NON_RETRYABLE";
  if (code === 402) return "INSUFFICIENT_CREDITS";
  if (code === 429) return "RATE_LIMIT";
  if (code >= 500) return "PROVIDER_ERROR";
  if (code >= 400) return "INVALID_INPUT";
  return "PROVIDER_ERROR";
}

export async function runExternalVideoJob(job: { payload: any }) {
  const p = job.payload || {};
  if (!FAL_KEY) throw new Error("EXTERNAL_VIDEO_API_KEY is not set");
  if (p.task !== "i2v")
    throw new Error(`external provider currently supports i2v only; got task=${p.task}`);
  if (!p.reference_image_base64 || typeof p.reference_image_base64 !== "string")
    throw new Error("external i2v requires reference_image_base64");

  const imageUri = p.reference_image_base64.startsWith("data:")
    ? p.reference_image_base64
    : `data:image/jpeg;base64,${p.reference_image_base64}`;

  const body: Record<string, unknown> = {
    prompt: p.prompt,
    image_url: imageUri,
    seed: p.seed ?? 123,
    num_frames: p.num_frames ?? 81,
    fps: p.fps ?? 16,
    resolution: p.resolution ?? "480p",
    aspect_ratio: p.aspect_ratio ?? "16:9",
  };
  if (p.negative_prompt) body.negative_prompt = p.negative_prompt;

  const submit = await fetch(FAL_SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => "");
    const err: any = new Error(`external submit HTTP ${submit.status}: ${t.slice(0, 400)}`);
    err.category = classifyHttp(submit.status);
    throw err;
  }
  const submitJson: any = await submit.json();
  const requestId: string =
    submitJson.request_id || submitJson.requestId || submitJson.id;
  if (!requestId) throw new Error(`external: no request_id in response`);

  const statusUrl = `${FAL_STATUS_BASE}/${requestId}/status`;
  const resultUrl = `${FAL_STATUS_BASE}/${requestId}`;
  const deadline = Date.now() + MAX_WAIT_MS;
  let last: any = null;
  while (Date.now() < deadline) {
    const r = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      last = await r.json();
      const st = (last?.status || "").toUpperCase();
      if (st === "COMPLETED") break;
      if (st === "FAILED" || st === "ERROR") {
        throw new Error(`external job failed: ${JSON.stringify(last).slice(0, 400)}`);
      }
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  if (!last || (last.status || "").toUpperCase() !== "COMPLETED") {
    const err: any = new Error(`external job ${requestId} timed out`);
    err.category = "TIMEOUT";
    throw err;
  }

  const rr = await fetch(resultUrl, {
    headers: { Authorization: `Key ${FAL_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!rr.ok) throw new Error(`external result HTTP ${rr.status}`);
  const result: any = await rr.json();
  const videoUrl: string =
    result?.video?.url || result?.output?.video?.url || result?.video_url;
  if (!videoUrl)
    throw new Error(`external: no video.url in result: ${JSON.stringify(result).slice(0, 400)}`);

  fs.mkdirSync(NASHASH_VIDEO_DIR, { recursive: true });
  const fileName = `ext_${requestId}.mp4`;
  const localPath = path.join(NASHASH_VIDEO_DIR, fileName);
  const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
  if (!dl.ok) throw new Error(`external download HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
    throw new Error(`external: downloaded file missing/empty`);
  }

  const { stdout } = await pExec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_type",
    "-of", "json",
    localPath,
  ]);
  const probe = JSON.parse(stdout);
  const dur = Number(probe?.format?.duration ?? 0);
  const hasVideo = (probe?.streams || []).some((s: any) => s.codec_type === "video");
  if (!(dur > 0) || !hasVideo)
    throw new Error(`external: ffprobe failed (dur=${dur}, hasVideo=${hasVideo})`);

  return {
    mp4_path: localPath,
    remote_path: videoUrl,
    duration: dur,
    worker_jid: requestId,
    probe,
    provider: "external-fal-hunyuan-i2v",
  };
}
