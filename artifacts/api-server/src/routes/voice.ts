import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import { createProductionJob, getProductionJob } from "../lib/productionEngine";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const UPLOADS_AUDIO_DIR = path.resolve(process.cwd(), "uploads/audio");
if (!fs.existsSync(UPLOADS_AUDIO_DIR)) fs.mkdirSync(UPLOADS_AUDIO_DIR, { recursive: true });

// ─── KAYAN-FIX-03: Path-traversal guard for any id used in a path ───
const SAFE_ID = /^[A-Za-z0-9_\-]{1,64}$/;
function sanitizeId(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!SAFE_ID.test(s)) throw new Error(`Invalid ${field}: must match ${SAFE_ID}`);
  return s;
}

// ─── Deepgram Aura is the ONLY production voice provider ───
// (edge-tts removed; kayanVoiceWorker.js is LEGACY and not used.)
export const DIALECT_VOICES: Record<string, string> = {
  gulf_male: "aura-arcas-en",
  gulf_female: "aura-asteria-en",
  egyptian_male: "aura-orion-en",
  egyptian_female: "aura-luna-en",
  syrian_male: "aura-zeus-en",
  syrian_female: "aura-stella-en",
  emirati_male: "aura-orpheus-en",
  emirati_female: "aura-athena-en",
  default: "aura-asteria-en",
};
const DEFAULT_VOICE = "aura-asteria-en";

// ─── ffprobe (spawn + array args, no shell string) ───
function ffprobeAudio(filePath: string): Promise<{
  duration: number;
  codec: string;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
}> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-show_entries",
      "format=duration,size:stream=codec_name,sample_rate,channels,codec_type",
      "-of", "json",
      filePath,
    ];
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 400)}`));
      try {
        const j = JSON.parse(out);
        const audioStream = (j.streams || []).find((s: any) => s.codec_type === "audio");
        if (!audioStream) return reject(new Error("ffprobe: no audio stream"));
        const duration = Number(j?.format?.duration ?? 0);
        if (!(duration > 0)) return reject(new Error(`ffprobe: invalid duration ${duration}`));
        const size = Number(j?.format?.size ?? 0);
        if (!(size > 0)) return reject(new Error(`ffprobe: invalid size ${size}`));
        resolve({
          duration,
          codec: String(audioStream.codec_name || ""),
          sampleRate: Number(audioStream.sample_rate || 0),
          channels: Number(audioStream.channels || 0),
          sizeBytes: size,
        });
      } catch (e: any) {
        reject(new Error(`ffprobe parse error: ${e?.message || e}`));
      }
    });
  });
}

// ─── POST /voice/generate — official production entrypoint ───
router.post(
  ["/voice/generate", "/generate", "/"],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body || {};
      const rawText = typeof body.text === "string" ? body.text.trim() : "";
      if (!rawText) {
        res.status(400).json({ error: "Text prompt is required." });
        return;
      }
      if (rawText.length > 5000) {
        res.status(400).json({ error: "Text too long (max 5000 chars)." });
        return;
      }

      let shotId: number | null = null;
      let dialogueId: string | null = null;
      let characterId: string | null = null;
      let voiceId: string | null = null;
      try {
        dialogueId = sanitizeId(body.dialogueId, "dialogueId");
        characterId = sanitizeId(body.characterId, "characterId");
        voiceId = sanitizeId(body.voiceId, "voiceId");
        if (body.shotId !== undefined && body.shotId !== null && body.shotId !== "") {
          const n = Number(body.shotId);
          if (!Number.isInteger(n) || n < 1) throw new Error("Invalid shotId");
          shotId = n;
        }
      } catch (e: any) {
        res.status(400).json({ error: e?.message || "Invalid identifier" });
        return;
      }

      const dialect = typeof body.dialect === "string" ? body.dialect : "default";
      const model =
        voiceId ||
        DIALECT_VOICES[dialect] ||
        process.env.DEEPGRAM_TTS_MODEL?.trim() ||
        DEFAULT_VOICE;

      // PG-backed job via productionEngine → production_pipeline
      const job = await createProductionJob("VOICE_GEN", {
        projectId: typeof body.projectId === "number" ? body.projectId : undefined,
        text: rawText,
        model,
        shotId: shotId ?? undefined,
        dialogueId: dialogueId ?? undefined,
        characterId: characterId ?? undefined,
      });

      // Short synchronous wait for Deepgram (~1-3s typical)
      const deadline = Date.now() + 25_000;
      let final: any = job;
      while (Date.now() < deadline) {
        const j = await getProductionJob(job.id);
        if (!j) break;
        final = j;
        if (j.status === "completed" || j.status === "failed") break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (final.status === "failed") {
        res.status(502).json({
          success: false,
          jobId: final.id,
          status: "failed",
          error: final.error || "Voice generation failed",
        });
        return;
      }
      if (final.status !== "completed") {
        // Still queued/processing — do NOT fabricate a success.
        res.status(202).json({
          success: false,
          jobId: final.id,
          status: final.status,
          audioUrl: null,
        });
        return;
      }

      const output = (final.output || {}) as any;
      const audioPath = String(output.audioPath || "");
      const audioUrl = String(output.audioUrl || "");
      if (!audioPath || !audioUrl || !fs.existsSync(audioPath)) {
        res.status(500).json({
          success: false,
          jobId: final.id,
          status: "failed",
          error: "VOICE_GEN completed but audio asset is missing or empty",
        });
        return;
      }

      let probe;
      try {
        probe = await ffprobeAudio(audioPath);
      } catch (e: any) {
        res.status(500).json({
          success: false,
          jobId: final.id,
          status: "failed",
          error: `Audio verification failed: ${e?.message || e}`,
        });
        return;
      }

      if (shotId !== null) {
        try {
          await db
            .update(shotsTable)
            .set({ audioUrl, audioStatus: "COMPLETED" })
            .where(eq(shotsTable.id, shotId));
        } catch (e: any) {
          logger.warn({ err: e?.message, shotId }, "voice: shot link failed");
        }
      }

      res.status(201).json({
        success: true,
        jobId: final.id,
        provider: "deepgram",
        model,
        audioUrl,
        audioPath,
        durationSeconds: probe.duration,
        codec: probe.codec,
        sampleRate: probe.sampleRate,
        channels: probe.channels,
        fileSize: probe.sizeBytes,
        shotId,
      });
    } catch (err: any) {
      logger.error({ err: err?.message }, "voice.generate failed");
      res.status(500).json({ success: false, error: err?.message || "Voice generation failed" });
    }
  },
);

// ─── GET /voice/jobs/:id — PG-backed state read ───
router.get(
  ["/voice/jobs/:id", "/jobs/:id"],
  async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id || "").trim();
    if (!SAFE_ID.test(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const job = await getProductionJob(id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  },
);

export default router;
