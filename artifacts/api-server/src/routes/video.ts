import { generateVideoKayanGpu } from "../lib/kayanGpuProvider";
import { Router, type IRouter, type Request, type Response } from "express";
import { GenerateVideoBody } from "@workspace/api-zod";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import { validateProxyUrl, requireProductionAuth } from "../lib/securityMiddleware";
import { createProductionJob, getProductionJob } from "../lib/productionEngine";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════════════════════
// KAYAN-FIX-08 — Rate limit + content moderation for /generate
// ═══════════════════════════════════════════════════════════════════════
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many video generation requests. Limit: 10 per hour per IP." },
});

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODERATION_MODEL = "llama-3.1-8b-instant";
const MODERATION_TIMEOUT_MS = 8000;

// KAYAN-FIX-08 — local heuristic moderation (no external API dependency).
// Provider fallback path is intentionally NOT used here because all external
// LLM keys are currently unavailable (Groq=invalid, Google=quota 0, LLM 8082=down).
// This is a deterministic blocklist that never silently passes obviously-unsafe
// requests. It is intentionally conservative: only clearly-unsafe content is
// rejected; benign descriptions pass.
const UNSAFE_PATTERNS: RegExp[] = [
  // real-person likeness / deepfake
  /\b(real|actual|genuine)\s+(celebrity|actor|actress|person|human|politician)/i,
  /deep\s?fake/i,
  /(likeness|face)\s+of\s+(a\s+)?real\s+(person|human|celebrity)/i,
  // sexual content / minors
  /\b(explicit|porn|pornographic|nude|naked|nsfw|sexual)\b/i,
  /\b(child|minor|underage|preteen|kid)\b.*\b(sexual|nude|naked|explicit)\b/i,
  /\b(sexual|nude|naked|explicit)\b.*\b(child|minor|underage|preteen|kid)\b/i,
  // graphic violence
  /\b(gore|dismember|behead|torture)\b/i,
  // hate / illegal-harm
  /\b(hate\s+speech|ethnic\s+cleansing|genocide)\b/i,
  /how\s+to\s+(make|build)\s+(a\s+)?(bomb|explosive|weapon)/i,
];

function classifyPrompt(text: string): "safe" | "unsafe" {
  const s = String(text || "");
  for (const re of UNSAFE_PATTERNS) {
    if (re.test(s)) return "unsafe";
  }
  return "safe";
}

// Removed Replicate dependency line
const MAX_POLLING_ATTEMPTS = 60;
const POLLING_INTERVAL_MS = 3000;
const HTTP_TIMEOUT_MS = 30000;

function extractVideoUrl(output: unknown): string | undefined {
  if (typeof output === "string" && output.trim().length > 0) return output.trim();
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string" && first.trim().length > 0) return first.trim();
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["videoUrl", "video", "video_url", "url", "output", "syncedVideoUrl"]) {
      const val = record[key];
      if (typeof val === "string" && val.trim().length > 0) return val.trim();
    }
  }
  return undefined;
}

function isPublicHttpUrl(value: string): boolean {
  // SSRF-safe: delegates to strict validateProxyUrl (blocks localhost/private/metadata).
  return validateProxyUrl(value);
}

function getDownloadUrl(videoUrl: string): string {
  return `/api/video/download?url=${encodeURIComponent(videoUrl)}`;
}

router.post("/generate", generateLimiter, requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  // KAYAN-FIX-08 — moderate the prompt BEFORE any GPU submission.
  try {
    const p = String((req.body && (req.body.prompt ?? req.body.text)) || "").trim();
    if (p.length > 0) {
      const verdict = classifyPrompt(p);
      if (verdict === "unsafe") {
        res.status(400).json({ error: "PROMPT_REJECTED_UNSAFE", message: "Prompt rejected by content moderation." });
        return;
      }
    }
  } catch (e: any) {
    res.status(503).json({ error: "MODERATION_UNAVAILABLE", message: e?.message || "moderation failed" });
    return;
  }
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // KAYAN-TASK-02 — explicit I2V contract validation BEFORE any GPU submission.
  const __d = parsed.data as any;
  logger.info({
    __marker: "KAYAN-I2V-DEBUG-v1",
    __task_resolved: __d.task,
    __has_ref: !!__d.referenceImageBase64,
  }, "[I2V-DEBUG] route entry");
  const __task: 't2v' | 'i2v' = __d.task === 'i2v' ? 'i2v' : 't2v';
  if (__task === 'i2v') {
    if (!__d.referenceImageBase64 || typeof __d.referenceImageBase64 !== 'string' || __d.referenceImageBase64.length < 64) {
      res.status(400).json({ error: 'i2v requires referenceImageBase64 (>=64 chars)' });
      return;
    }
  }
  if (__d.numFrames != null && (__d.numFrames - 1) % 4 !== 0) {
    res.status(400).json({ error: `numFrames=${__d.numFrames} violates (n-1)%4==0` });
    return;
  }
  if (__d.durationSeconds != null && !(__d.durationSeconds > 0 && __d.durationSeconds <= 10)) {
    res.status(400).json({ error: `durationSeconds out of range: ${__d.durationSeconds}` });
    return;
  }

  try {
    logger.info({ projectId: parsed.data.projectId, prompt: parsed.data.prompt }, "Dispatching video generation to KayanGPU Production Engine...");

    const job = await createProductionJob("VIDEO_GEN", {
      projectId: parsed.data.projectId,
      prompt: parsed.data.prompt,
      worldId: parsed.data.worldId,
      microExpression: parsed.data.microExpression,
      task: __task,
      referenceImageBase64: __d.referenceImageBase64,
      negativePrompt: __d.negativePrompt,
      fps: __d.fps,
      durationSeconds: __d.durationSeconds,
      numFrames: __d.numFrames,
      aspectRatio: __d.aspectRatio,
      seed: __d.seed,
      resolution: __d.resolution,
      steps: __d.steps
    }, 0);

    let currentJob = job;
    let attempts = 0;
    while (currentJob.status !== "completed" && currentJob.status !== "failed" && attempts < 600) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      const checked = await getProductionJob(job.id);
      if (checked) currentJob = checked;
      attempts++;
    }

    if (currentJob.status === "completed") {
      const outputObj = currentJob.output as any;
      const videoUrl = extractVideoUrl(outputObj) || outputObj?.videoUrl;
      
      if (!videoUrl) {
        res.status(502).json({ error: "KayanGPU completed job but returned no valid video URL." });
        return;
      }

      const isLocal = typeof videoUrl === "string" && videoUrl.startsWith("/uploads/");
      res.json({
        videoUrl,
        downloadUrl: isLocal ? videoUrl : getDownloadUrl(videoUrl),
        streamUrl: isLocal ? videoUrl : `/api/video/stream?url=${encodeURIComponent(videoUrl)}`,
        status: "completed",
        provider: "kayan-gpu-worker",
        jobId: currentJob.id,
      });
      return;
    }

    if (currentJob.status === "failed") {
      res.status(502).json({ error: "KayanGPU Worker generation failed", message: currentJob.error || "Unknown GPU error" });
      return;
    }

    res.status(504).json({
        videoUrl: "",
        downloadUrl: "",
        status: "timeout",
        provider: "kayan-gpu-worker",
        jobId: currentJob.id,
        message: "Job still processing on KayanGPU worker after 5 hours."
      });

  } catch (error: any) {
    logger.error({ err: error }, "KayanGPU Production Video routing crashed");
    res.status(502).json({
      error: "Production Video generation failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/stream", async (req: Request, res: Response): Promise<void> => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!targetUrl || !isPublicHttpUrl(targetUrl)) {
    res.status(400).json({ error: "Invalid streaming URL." });
    return;
  }
  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "http:" ? http : https;
    client.get(targetUrl, (upstream) => {
      res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
      upstream.pipe(res);
    }).on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "Stream proxy failed" });
    });
  } catch {
    res.status(400).json({ error: "Malformed URL" });
  }
});

router.get("/download", async (req: Request, res: Response): Promise<void> => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!targetUrl || !isPublicHttpUrl(targetUrl)) {
    res.status(400).json({ error: "Invalid download URL." });
    return;
  }
  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "http:" ? http : https;
    client.get(targetUrl, (upstream) => {
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", 'attachment; filename="kayan-production.mp4"');
      upstream.pipe(res);
    }).on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "Download failed" });
    });
  } catch {
    res.status(400).json({ error: "Malformed URL" });
  }
});

export default router;
