import { Router, type IRouter, type Request, type Response } from "express";
import { saveAudioBuffer } from "../lib/audioAssets";
import { resolveAudioShotId, persistAudioUrlToShot } from "../lib/audioShotLink";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 20000;
const DEEPGRAM_TTS_ENDPOINT = "https://api.deepgram.com/v1/speak";



router.post("/audio/generate", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const { text, model = "aura-asteria-en" } = req.body || {};
  
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "text field is required and must be a non-empty string." });
    return;
  }

  // KAYAN-TASK-47: optional projectId + shotId. Kept out of the OpenAPI
  // schema for backwards compatibility. When both are present, the saved
  // audioUrl is linked to that shot after successful persistence so that
  // timeline/sync finds a real VOICE asset.
  const rawProjectId = (req.body && (req.body as any).projectId) as unknown;
  const rawShotId = (req.body && (req.body as any).shotId) as unknown;
  let linkProjectId: number | null = null;
  let linkShotId: number | null = null;
  if (rawShotId !== undefined && rawShotId !== null) {
    if (rawProjectId === undefined || rawProjectId === null) {
      res.status(400).json({ error: "projectId is required when shotId is provided" });
      return;
    }
    const pid = Number(rawProjectId);
    if (!Number.isInteger(pid) || pid <= 0) {
      res.status(400).json({ error: "projectId must be a positive integer" });
      return;
    }
    const resolved = await resolveAudioShotId(rawShotId, pid);
    if (resolved.ok === false) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    linkProjectId = pid;
    linkShotId = resolved.shotId;
  }

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({ error: "DEEPGRAM_API_KEY is missing from environment variables." });
    return;
  }

  try {
    console.info({ text, model }, "Starting real Deepgram TTS generation job via Aura Engine");

    const response = await fetch(`${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(model)}`, {
      method: "POST",
      headers: {
        "Authorization": `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Deepgram TTS Failed (${response.status}): ${errText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    if (audioBuffer.byteLength === 0) {
      throw new Error("Deepgram returned 0 bytes audio stream.");
    }

    const buf = Buffer.from(audioBuffer);
    // KAYAN-TASK-46: persist to disk in uploads/audio/.
    const saved = saveAudioBuffer(buf, { ext: ".mp3" });
    if (saved.ok === false) {
      console.error({ err: saved.error }, "audio persistence failed");
      res.status(saved.status).json({ error: saved.error });
      return;
    }
    // KAYAN-TASK-47: link to shot if requested.
    if (linkShotId !== null) {
      const pr = await persistAudioUrlToShot(linkShotId, saved.url);
      if (pr.ok === false) {
        res.status(pr.status).json({ error: pr.error });
        return;
      }
    }
    // Backwards-compat: keep data: URL available for clients that read it.
    const dataUrl = `data:audio/mp3;base64,${buf.toString("base64")}`;
    console.info({ filePath: saved.filePath, size: saved.sizeBytes, shotId: linkShotId }, "Deepgram Audio Asset saved to disk");
    res.json({
      success: true,
      audioUrl: saved.url,
      audioDataUrl: dataUrl,
      filePath: saved.filePath,
      sizeBytes: saved.sizeBytes,
      provider: "deepgram-tts",
      ...(linkShotId !== null ? { linkedShotId: linkShotId, linkedProjectId: linkProjectId } : {}),
    });
  } catch (error) {
    console.error({ err: error }, "Real Deepgram TTS process failed");
    res.status(502).json({
      error: "Audio generation failed",
      message: error instanceof Error ? error.message : "Unknown Deepgram provider error",
    });
  }
});

export default router;
