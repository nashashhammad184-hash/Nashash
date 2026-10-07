/**
 * pipeline.ts — OFFICIAL PRODUCTION PIPELINE (Task 61427)
 *
 * Single orchestrator for the full real production chain:
 *
 *   Project → Script → Shots → Voice → Video → Lip Sync → Timeline
 *     → Auto Edit → Subtitles → Render → Final MP4
 *
 * Every stage produces a REAL asset consumed by the next stage.
 * No dummy assets, no color video, no placeholder URLs, no Replicate.
 *
 * Persistence: production_pipeline table (survives API restart).
 * GPU work:    delegated to GpuQueueService via productionEngine / kayanGpuProvider.
 * Render:      renderEngine.runRenderPipeline (real MP4 + optional audio mux).
 * Subtitles:   subtitleService.generateSRT / generateVTT (real SRT/VTT strings).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { and, desc, eq, asc } from "drizzle-orm";
import {
  db,
  projectsTable,
  scriptsTable,
  shotsTable,
  productionPipeline,
  timelineItemsTable,
  editClipsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createProductionJob,
  getProductionJob,
  type ProductionJobType,
} from "../lib/productionEngine";
import { buildPipelineJobKey } from "../lib/pipeline/jobKeys";
import {
  createRenderJob,
  runRenderPipeline,
  getRenderJobStatus,
  type RenderClipInput,
} from "../lib/renderEngine";
import { generateSRT, generateVTT, type SubtitleItem } from "../lib/subtitleService";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router: IRouter = Router();

// ================================================================
// Types
// ================================================================

export type StageName =
  | "project" | "script" | "shots" | "voice" | "video"
  | "lipsync" | "timeline" | "auto_edit" | "subtitles"
  | "render" | "final_mp4";

const STAGE_ORDER: StageName[] = [
  "project", "script", "shots", "voice", "video",
  "lipsync", "timeline", "auto_edit", "subtitles",
  "render", "final_mp4",
];

export type StageStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

interface StageResult {
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

type StageMap = Record<StageName, StageResult>;

function emptyStages(): StageMap {
  const m: Partial<StageMap> = {};
  for (const s of STAGE_ORDER) m[s] = { status: "pending" };
  return m as StageMap;
}

// ================================================================
// Helpers
// ================================================================

function uploadsDir(sub: string): string {
  const dir = path.resolve(process.cwd(), "uploads", sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isRealAsset(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  return /^https?:\/\//i.test(t) || t.startsWith("/uploads/");
}

function assertFile(p: string, label: string): void {
  if (!fs.existsSync(p)) throw new Error(`${label}: file not found at ${p}`);
  const st = fs.statSync(p);
  if (!st.isFile() || st.size === 0) throw new Error(`${label}: file is empty at ${p}`);
}
// KAYAN-TASK-06 — verify a real audio asset (stream present, duration>0, size>0).
async function assertRealAudioFile(p: string, label: string): Promise<{ duration: number; sizeBytes: number }> {
  assertFile(p, label);
  const st = fs.statSync(p);
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type,duration",
      "-show_entries", "format=duration",
      "-of", "json",
      p,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve({ stdout: out }) : reject(new Error(`ffprobe ${label} exit ${code}: ${err.slice(0,200)}`)));
  });
  const j = JSON.parse(stdout || "{}");
  const stream = (j.streams || [])[0];
  if (!stream || stream.codec_type !== "audio") {
    throw new Error(`${label}: no audio stream (ffprobe=${stdout.slice(0,200)})`);
  }
  const dur = Number(stream.duration ?? j?.format?.duration ?? 0);
  if (!(dur > 0)) throw new Error(`${label}: audio duration <= 0 (${dur})`);
  if (st.size === 0) throw new Error(`${label}: audio file size 0`);
  return { duration: dur, sizeBytes: st.size };
}

async function updateRun(
  runId: string,
  patch: Partial<{
    status: string;
    progress: number;
    payload: any;
    output: any;
    errorMessage: string | null;
    videoUrl: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(productionPipeline)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(productionPipeline.id, runId));
}

async function readRun(runId: string) {
  const rows = await db.select().from(productionPipeline).where(eq(productionPipeline.id, runId)).limit(1);
  return rows[0] ?? null;
}

// ================================================================
// Execution — the real chain
// ================================================================

interface PipelineInput {
  projectId: number;
  prompt?: string;
  text?: string;
  voiceText?: string;
  microExpression?: string;
  skipLipSync?: boolean;
  skipVideo?: boolean;
  includeSubtitles?: boolean;
  // KAYAN-FACE-ROOT-02 — I2V pathway
  task?: "t2v" | "i2v";
  referenceImageBase64?: string;
  negativePrompt?: string;
  fps?: number;
  durationSeconds?: number;
  numFrames?: number;
  aspectRatio?: string;
}

async function executePipeline(runId: string, input: PipelineInput): Promise<void> {
  const stages = emptyStages();
  const persistStages = async () => {
    const row = await readRun(runId);
    const payload = (row?.payload ?? {}) as any;
    payload.stages = stages;
    payload.currentStage = currentStage;
    await updateRun(runId, { payload, progress: overallProgress() });
  };

  let currentStage: StageName = "project";
  const overallProgress = (): number => {
    const idx = STAGE_ORDER.indexOf(currentStage);
    const base = Math.floor((idx / STAGE_ORDER.length) * 100);
    return Math.min(99, base);
  };

  const beginStage = async (name: StageName) => {
    currentStage = name;
    stages[name] = { status: "processing", startedAt: new Date().toISOString() };
    await persistStages();
  };
  const completeStage = async (name: StageName, output: Record<string, unknown>) => {
    stages[name] = { ...stages[name], status: "completed", completedAt: new Date().toISOString(), output };
    await persistStages();
  };
  const failStage = async (name: StageName, message: string) => {
    stages[name] = { ...stages[name], status: "failed", completedAt: new Date().toISOString(), error: message };
    await persistStages();
  };

  const projectId = input.projectId;

  try {
    await updateRun(runId, { status: "processing", startedAt: new Date() });

    // ------------------------------------------------------------
    // 1. Project
    // ------------------------------------------------------------
    await beginStage("project");
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) throw new Error(`Project ${projectId} not found`);
    await completeStage("project", { projectId, title: project.title, worldId: project.worldId });

    // ------------------------------------------------------------
    // 2. Script (must already exist — we don't fabricate one)
    // ------------------------------------------------------------
    await beginStage("script");
    const [latestScript] = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.projectId, projectId))
      .orderBy(desc(scriptsTable.createdAt))
      .limit(1);

    if (!latestScript) throw new Error("Script stage requires an existing script for this project");
    if (!latestScript.generatedContent || latestScript.generatedContent.trim().length === 0) {
      throw new Error("Script has empty generatedContent");
    }
    await completeStage("script", {
      scriptId: latestScript.id,
      length: latestScript.generatedContent.length,
    });

    // ------------------------------------------------------------
    // 3. Shots (must already exist with real duration)
    // ------------------------------------------------------------
    await beginStage("shots");
    const shots = await db
      .select()
      .from(shotsTable)
      .where(eq(shotsTable.projectId, projectId))
      .orderBy(asc(shotsTable.sceneNumber), asc(shotsTable.id));
    if (shots.length === 0) throw new Error("Shots stage requires at least one shot");
    await completeStage("shots", { count: shots.length, shotIds: shots.map((s) => s.id) });

    // ------------------------------------------------------------
    // 4. Voice — real Deepgram TTS per shot that has dialogue
    // ------------------------------------------------------------
    await beginStage("voice");
    // KAYAN-TASK-06 — one independent VOICE_GEN per shot that has dialogue.
    // Policy for input.voiceText: it is only honored as an override when there
    // is EXACTLY ONE dialogue shot in the project. In multi-shot productions it
    // is IGNORED (never masks per-shot dialogues).
    const dialogueShots = shots.filter((s) => (s.dialogue || "").trim().length > 0);
    const perShotVoice: Record<number, VoiceEntry> = {};
    type VoiceEntry = { audioPath: string; audioUrl: string; text: string; duration: number; sizeBytes: number; jobId: string };
    // KAYAN-TASK-27: no dialogue anywhere in the project → Voice stage SKIPPED.
    // No VOICE_GEN jobs are created. No fake audio. Pipeline continues.
    if (dialogueShots.length === 0) {
      stages.voice = {
        status: "skipped",
        completedAt: new Date().toISOString(),
        output: { reason: "NO_DIALOGUE", source: "shots" },
      };
      await persistStages();
    } else {
    const singleDialogueOverride =
      dialogueShots.length === 1 && input.voiceText && input.voiceText.trim().length > 0
        ? input.voiceText.trim()
        : null;


    for (const shot of dialogueShots) {
      const voiceText = (singleDialogueOverride ?? shot.dialogue ?? "").trim();
      if (!voiceText) continue;

      const payload: Record<string, unknown> = {
        projectId,
        shotId: shot.id,
        dialogueId: shot.id,                 // shot.id is the canonical dialogue anchor in this schema
        text: voiceText,
      };
      // character/voice association (schema-level: shots.voice_id, actors.voiceId)
      const shotVoiceId = (shot as any).voice_id as string | undefined;
      if (shotVoiceId) payload.voiceId = shotVoiceId;

      const voiceJob = await createProductionJob("VOICE_GEN", payload, 3, {
        parentRunId: runId,
        jobKey: buildPipelineJobKey(runId, "VOICE_GEN", shot.id),
      });
      const voiceDone = await waitForJob(voiceJob.id);
      if (voiceDone.status !== "completed") {
        await db.update(shotsTable)
          .set({ audioStatus: "FAILED" } as any)
          .where(eq(shotsTable.id, shot.id));
        throw new Error(`VOICE_GEN failed for shot ${shot.id}: ${voiceDone.error || "unknown"}`);
      }
      const voiceOutput = (voiceDone.output || {}) as any;
      const audioPath = voiceOutput.audioPath as string;
      const audioUrl = voiceOutput.audioUrl as string;
      if (!audioPath || !isRealAsset(audioUrl)) {
        await db.update(shotsTable).set({ audioStatus: "FAILED" } as any).where(eq(shotsTable.id, shot.id));
        throw new Error(`VOICE_GEN shot ${shot.id} returned no real audio asset`);
      }
      if (audioUrl.startsWith("data:")) {
        await db.update(shotsTable).set({ audioStatus: "FAILED" } as any).where(eq(shotsTable.id, shot.id));
        throw new Error(`VOICE_GEN shot ${shot.id} returned a data: URL (not allowed in production)`);
      }

      const { duration, sizeBytes } = await assertRealAudioFile(audioPath, `voice audio shot ${shot.id}`);

      // Persist per-shot association in shots table
      await db.update(shotsTable)
        .set({ audioUrl, audioStatus: "COMPLETED" } as any)
        .where(eq(shotsTable.id, shot.id));

      perShotVoice[shot.id] = { audioPath, audioUrl, text: voiceText, duration, sizeBytes, jobId: voiceJob.id };
    }

    if (Object.keys(perShotVoice).length === 0) {
      throw new Error("Voice stage produced no audio assets");
    }
    await completeStage("voice", {
      provider: "deepgram",
      shotsVoiced: Object.keys(perShotVoice).length,
      perShot: Object.entries(perShotVoice).map(([id, v]) => ({
        shotId: Number(id),
        jobId: v.jobId,
        audioPath: v.audioPath,
        audioUrl: v.audioUrl,
        duration: v.duration,
        sizeBytes: v.sizeBytes,
      })),
    });
    }

    // ------------------------------------------------------------
    // 5. Video — real KayanGPU VIDEO_JOB per shot (or existing shot.videoUrl if skipVideo)
    // ------------------------------------------------------------
    await beginStage("video");
    // KAYAN-TASK-22: Full Pipeline video stage is I2V-only. Reject before
    // creating any VIDEO_GEN job — no T2V fallback, no reference-less I2V.
    if (!input.skipVideo) {
      if (input.task !== "i2v") {
        throw Object.assign(
          new Error(
            "VIDEO_I2V_REQUIRED: Full Pipeline video stage requires task='i2v' " +
            "(received " + JSON.stringify(input.task) + ")"
          ),
          { code: "VIDEO_I2V_REQUIRED" },
        );
      }
      const refB64 = (input.referenceImageBase64 || "").trim();
      if (!refB64 || refB64.length < 64) {
        throw Object.assign(
          new Error(
            "I2V_REFERENCE_IMAGE_REQUIRED: Full Pipeline requires " +
            "referenceImageBase64 (>=64 chars) when task='i2v'"
          ),
          { code: "I2V_REFERENCE_IMAGE_REQUIRED" },
        );
      }
    }
    const perShotVideo: Record<number, { videoPath: string; videoUrl: string }> = {};
    for (const shot of shots) {
      if (input.skipVideo) {
        const shotVideo = (shot.videoUrl || "").trim();
        if (!isRealAsset(shotVideo)) {
          throw new Error(`skipVideo=true but shot ${shot.id}.videoUrl is not a real asset`);
        }
        const vp = shotVideo.startsWith("/uploads/")
          ? path.resolve(process.cwd(), shotVideo.replace(/^\//, ""))
          : shotVideo;
        assertFile(vp, `existing shot ${shot.id} video`);
        perShotVideo[shot.id] = { videoPath: vp, videoUrl: shotVideo };
      } else {
        const prompt = (shot.description || project.title || "").trim();
        if (!prompt) throw new Error(`Video prompt is empty for shot ${shot.id}`);
        const videoJob = await createProductionJob("VIDEO_GEN", {
          projectId,
          prompt,
          shotId: shot.id,
          task: "i2v" as const,
          referenceImageBase64: input.referenceImageBase64,
          ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
          ...(input.fps != null ? { fps: input.fps } : {}),
          ...(input.durationSeconds != null ? { durationSeconds: input.durationSeconds } : {}),
          ...(input.numFrames != null ? { numFrames: input.numFrames } : {}),
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        }, 3, {
          parentRunId: runId,
          jobKey: buildPipelineJobKey(runId, "VIDEO_GEN", shot.id),
        });
        const videoDone = await waitForJob(videoJob.id);
        if (videoDone.status !== "completed") {
          throw new Error(`VIDEO_GEN failed for shot ${shot.id}: ${videoDone.error || "unknown"}`);
        }
        const videoOutput = (videoDone.output || {}) as any;
        const vp = videoOutput.videoPath as string;
        const vu = videoOutput.videoUrl as string;
        if (!vp || !isRealAsset(vu)) throw new Error(`VIDEO_GEN shot ${shot.id} returned no real video asset`);
        assertFile(vp, `video shot ${shot.id}`);
        perShotVideo[shot.id] = { videoPath: vp, videoUrl: vu };
      }
    }
    await completeStage("video", {
      provider: input.skipVideo ? "existing-shot" : "kayangpu",
      shotsVideod: Object.keys(perShotVideo).length,
      perShot: Object.entries(perShotVideo).map(([id, v]) => ({ shotId: Number(id), videoPath: v.videoPath, videoUrl: v.videoUrl })),
    });

    // ------------------------------------------------------------
    // 6. Lip Sync — real LIP_SYNC_JOB per shot with audio (skip if requested)
    // ------------------------------------------------------------
    await beginStage("lipsync");
    // KAYAN-TASK-23: when LIPSYNC_ENABLED=false, the GPU worker path is
    // unavailable. Skip the stage cleanly — no LIP_SYNC jobs created, no GPU
    // calls, pipeline continues with original videos as "synced" passthrough.
    const LIPSYNC_ENABLED_CFG = (process.env.LIPSYNC_ENABLED || "false").toLowerCase() === "true";
    const perShotSynced: Record<number, { syncedVideoPath: string; syncedVideoUrl: string }> = {};
    if (!LIPSYNC_ENABLED_CFG) {
      for (const shot of shots) {
        const v = perShotVideo[shot.id];
        if (!v) throw new Error(`lipsync: shot ${shot.id} has no video`);
        perShotSynced[shot.id] = { syncedVideoPath: v.videoPath, syncedVideoUrl: v.videoUrl };
      }
      stages.lipsync = {
        status: "skipped",
        completedAt: new Date().toISOString(),
        output: { reason: "LIPSYNC_DISABLED", source: "env" },
      };
      await persistStages();
    } else if (input.skipLipSync) {
      for (const shot of shots) {
        const v = perShotVideo[shot.id];
        if (!v) throw new Error(`lipsync: shot ${shot.id} has no video`);
        perShotSynced[shot.id] = { syncedVideoPath: v.videoPath, syncedVideoUrl: v.videoUrl };
      }
      stages.lipsync = { status: "skipped", completedAt: new Date().toISOString(), output: { reason: "skipLipSync=true" } };
      await persistStages();
    } else {
      for (const shot of shots) {
        const v = perShotVideo[shot.id];
        const a = perShotVoice[shot.id];
        if (!v) throw new Error(`lipsync: shot ${shot.id} has no video`);
        if (!a) {
          // KAYAN-TASK-07 — explicit production decision made BEFORE creating
          // any GPU job: this shot has no dialogue/audio, so Lip Sync is not
          // required. This is NOT a passthrough-after-failure; the job is
          // simply never created for a shot that has no voice track.
          perShotSynced[shot.id] = { syncedVideoPath: v.videoPath, syncedVideoUrl: v.videoUrl };
          continue;
        }
        const lipJob = await createProductionJob("LIP_SYNC", {
          projectId,
          shotId: shot.id,
          videoUrl: v.videoPath,
          audioUrl: a.audioPath,
        }, 3, {
          parentRunId: runId,
          jobKey: buildPipelineJobKey(runId, "LIP_SYNC", shot.id),
        });
        const lipDone = await waitForJob(lipJob.id);
        if (lipDone.status !== "completed") {
          throw new Error(`LIP_SYNC failed for shot ${shot.id}: ${lipDone.error || "unknown"}`);
        }
        const lipOutput = (lipDone.output || {}) as any;
        const sp = lipOutput.syncedVideoPath as string;
        const su = lipOutput.syncedVideoUrl as string;
        if (!sp || !isRealAsset(su)) throw new Error(`LIP_SYNC shot ${shot.id} returned no real synced video`);
        assertFile(sp, `synced video shot ${shot.id}`);
        // KAYAN-TASK-07 — synced output must differ from the input video.
        if (path.resolve(sp) === path.resolve(v.videoPath)) {
          throw new Error(`LIP_SYNC shot ${shot.id}: synced output equals input video — no actual sync performed`);
        }
        perShotSynced[shot.id] = { syncedVideoPath: sp, syncedVideoUrl: su };
      }
      await completeStage("lipsync", {
        provider: "kayangpu",
        shotsSynced: Object.keys(perShotSynced).length,
        perShot: Object.entries(perShotSynced).map(([id, v]) => ({ shotId: Number(id), syncedVideoPath: v.syncedVideoPath, syncedVideoUrl: v.syncedVideoUrl })),
      });
    }

    // ------------------------------------------------------------
    // 7. Timeline — cumulative VIDEO + VOICE rows for every shot
    // ------------------------------------------------------------
    await beginStage("timeline");
    // KAYAN-TASK-24: preserve MANUAL timeline items on pipeline rerun.
    // Only rows classified as "generated" (or legacy without origin) are
    // removed and rebuilt. Rows with metadata.origin === "manual" are kept
    // untouched. Classification mirrors routes/timeline.ts.
    const existingRows = await db
      .select()
      .from(timelineItemsTable)
      .where(eq(timelineItemsTable.projectId, projectId));
    const isManualRow = (row: any): boolean => {
      const raw = row?.metadata;
      if (!raw || typeof raw !== "string") return false;
      try {
        const m = JSON.parse(raw);
        return m && m.origin === "manual";
      } catch {
        return false;
      }
    };
    const manualRows = existingRows.filter(isManualRow);
    const generatedRows = existingRows.filter((r) => !isManualRow(r));
    if (generatedRows.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db
        .delete(timelineItemsTable)
        .where(inArray(timelineItemsTable.id, generatedRows.map((r) => r.id)));
    }
    // Manual rows stay untouched. Generated rows will be re-created below.
    // Order begins after the last manual row's order to keep manual edits visible.
    const maxManualOrder = manualRows.reduce(
      (m: number, r: any) => Math.max(m, Number(r.order) || 0),
      0,
    );
    const firstShotRow = existingRows[0];
    const firstShotTime = Number(firstShotRow?.startTime ?? 0);
    void firstShotTime;
    let currentTime = 0;
    let order = maxManualOrder + 1;
    const genMeta = JSON.stringify({ origin: "generated" });
    const timelineInserted: { assetUrl: string; duration: number; order: number; shotId: number }[] = [];
    for (const shot of shots) {
      const synced = perShotSynced[shot.id];
      if (!synced) throw new Error(`timeline: shot ${shot.id} has no synced video`);
      const dur = shot.durationSeconds || 5;
      const [vItem] = await db.insert(timelineItemsTable).values({
        projectId,
        shotId: shot.id,
        track: "VIDEO",
        startTime: currentTime,
        duration: dur,
        endTime: currentTime + dur,
        order: order++,
        content: shot.description || `Shot ${shot.id}`,
        assetUrl: synced.syncedVideoUrl,
        metadata: genMeta,
      }).returning();
      timelineInserted.push({ assetUrl: synced.syncedVideoUrl, duration: dur, order: vItem.order, shotId: shot.id });
      const voice = perShotVoice[shot.id];
      if (voice) {
        const [aItem] = await db.insert(timelineItemsTable).values({
          projectId,
          shotId: shot.id,
          track: "VOICE",
          startTime: currentTime,
          duration: dur,
          endTime: currentTime + dur,
          order: order++,
          content: voice.text,
          assetUrl: voice.audioUrl,
          metadata: genMeta,
        }).returning();
        void aItem;
      }
      currentTime += dur;
    }
    if (timelineInserted.length === 0) throw new Error("Timeline produced no real VIDEO assets");
    await completeStage("timeline", {
      totalDuration: currentTime,
      videoItems: timelineInserted.length,
      shotIds: shots.map((s) => s.id),
    });

    // ------------------------------------------------------------
    // 8. Auto Edit — one edit_clip per VIDEO item, cumulative timing
    // ------------------------------------------------------------
    await beginStage("auto_edit");
    let editCursor = 0;
    const clipsToInsert = timelineInserted.map((t, idx) => {
      const start = editCursor;
      const end = editCursor + t.duration;
      editCursor = end;
      return {
        projectId,
        title: `Auto-edit clip ${idx + 1}`,
        durationSeconds: Math.round(t.duration),
        clipOrder: idx + 1,
        trackType: "video",
        startTime: start,
        endTime: end,
        sourceStart: 0,
        sourceEnd: t.duration,
        volume: 1.0,
        assetId: t.assetUrl,
      };
    });
    await db.delete(editClipsTable).where(eq(editClipsTable.projectId, projectId));
    const insertedClips = await db.insert(editClipsTable).values(clipsToInsert).returning();
    await completeStage("auto_edit", { clipsInserted: insertedClips.length });

    // ------------------------------------------------------------
    // 9. Subtitles — generate real SRT/VTT strings from shot dialogue
    // ------------------------------------------------------------
    await beginStage("subtitles");
    const subtitleItems: SubtitleItem[] = [];
    let tAcc = 0;
    for (let i = 0; i < shots.length; i++) {
      const dur = shots[i].durationSeconds || 5;
      const text = (shots[i].dialogue || "").trim();
      if (text) {
        subtitleItems.push({
          orderIndex: i + 1,
          startTime: tAcc,
          endTime: tAcc + dur,
          text,
          language: "ar",
        });
      }
      tAcc += dur;
    }
    if (subtitleItems.length === 0) {
      // no dialogue in any shot → subtitles stage is explicitly skipped, NOT fabricated
      stages.subtitles = { status: "skipped", completedAt: new Date().toISOString(), output: { reason: "no dialogue" } };
      await persistStages();
    } else {
      const srt = generateSRT(subtitleItems);
      const vtt = generateVTT(subtitleItems);
      if (!srt || srt.trim().length === 0) throw new Error("SRT generation returned empty content");
      if (!vtt || vtt.trim().length === 0) throw new Error("VTT generation returned empty content");

      const srtPath = path.join(uploadsDir("subtitles"), `run_${runId}.srt`);
      const vttPath = path.join(uploadsDir("subtitles"), `run_${runId}.vtt`);
      fs.writeFileSync(srtPath, srt, "utf-8");
      fs.writeFileSync(vttPath, vtt, "utf-8");
      assertFile(srtPath, "srt");
      assertFile(vttPath, "vtt");

      await completeStage("subtitles", { srtPath, vttPath, entries: subtitleItems.length });
    }

    // ------------------------------------------------------------
    // 10. Render — real MP4 (video + audio mix) via renderEngine
    // ------------------------------------------------------------
    await beginStage("render");
    const renderClips: RenderClipInput[] = timelineInserted.map((t, idx) => ({
      id: `clip_${idx + 1}`,
      assetUrl: t.assetUrl,
      durationSeconds: t.duration,
      order: t.order,
    }));

    // KAYAN-TASK-28: build audio track only when Voice stage produced real audio.
    // Otherwise → video-only render (dialogue-free projects).
    const orderedVoicePaths = shots
      .map((sh) => perShotVoice[sh.id]?.audioPath)
      .filter((p): p is string => !!p);
    let renderAudioUrl: string | undefined;
    if (orderedVoicePaths.length === 0) {
      renderAudioUrl = undefined;  // VIDEO_ONLY mode
    } else if (orderedVoicePaths.length === 1) {
      renderAudioUrl = perShotVoice[shots.find((sh) => perShotVoice[sh.id])!.id].audioUrl;
    } else {
      const listPath = path.join(uploadsDir("voice"), `concat_${runId}.txt`);
      fs.writeFileSync(
        listPath,
        orderedVoicePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf-8",
      );
      const mergedName = `merged_${runId}.mp3`;
      const mergedPath = path.join(uploadsDir("voice"), mergedName);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-c:a", "libmp3lame", "-q:a", "4", mergedPath,
        ], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        proc.stderr.on("data", (d) => { err += d.toString(); });
        proc.on("error", reject);
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg concat failed (${code}): ${err.slice(0, 400)}`)));
      });
      assertFile(mergedPath, "merged voice audio");
      renderAudioUrl = `/uploads/voice/${mergedName}`;
    }
    if (renderAudioUrl !== undefined && !isRealAsset(renderAudioUrl)) {
      throw new Error("render: no real voice audio asset available");
    }
    const renderJob = await createRenderJob({
      projectId,
      clips: renderClips,
      audioUrl: renderAudioUrl,
      watermarkText: "PRODUCED BY KAYAN AI PRODUCTIONS",
    });

    await runRenderPipeline(renderJob.id);
    const renderStatus = await getRenderJobStatus(renderJob.id);
    if (!renderStatus || renderStatus.status !== "COMPLETED") {
      throw new Error(`Render failed: ${renderStatus?.error || "unknown"}`);
    }
    if (!renderStatus.outputPath || !renderStatus.outputUrl) {
      throw new Error("Render completed without outputPath/outputUrl");
    }
    assertFile(renderStatus.outputPath, "final mp4");
    await completeStage("render", {
      renderJobId: renderJob.id,
      outputPath: renderStatus.outputPath,
      outputUrl: renderStatus.outputUrl,
      duration: renderStatus.duration,
      sizeBytes: renderStatus.sizeBytes,
    });

    // ------------------------------------------------------------
    // 11. Final MP4 — verify
    // ------------------------------------------------------------
    await beginStage("final_mp4");
    const finalStatus = await getRenderJobStatus(renderJob.id);
    if (!finalStatus?.outputPath || !finalStatus.outputUrl) throw new Error("Final MP4 missing");
    assertFile(finalStatus.outputPath, "final mp4 verify");
    await completeStage("final_mp4", {
      outputPath: finalStatus.outputPath,
      outputUrl: finalStatus.outputUrl,
      duration: finalStatus.duration,
      sizeBytes: finalStatus.sizeBytes,
    });

    await updateRun(runId, {
      status: "completed",
      progress: 100,
      completedAt: new Date(),
      output: {
        finalMp4Path: finalStatus.outputPath,
        finalMp4Url: finalStatus.outputUrl,
        duration: finalStatus.duration,
        sizeBytes: finalStatus.sizeBytes,
        renderJobId: renderJob.id,
        shotIds: shots.map((sh) => sh.id),
        perShot: shots.map((sh) => ({
          shotId: sh.id,
          sceneNumber: sh.sceneNumber,
          hasVoice: !!perShotVoice[sh.id],
          voiceAsset: perShotVoice[sh.id]?.audioUrl ?? null,
          videoAsset: perShotVideo[sh.id]?.videoUrl ?? null,
          syncedAsset: perShotSynced[sh.id]?.syncedVideoUrl ?? null,
        })),
      },
      videoUrl: finalStatus.outputUrl,
      errorMessage: null,
    });

    logger.info({ runId, projectId, finalUrl: finalStatus.outputUrl }, "Production pipeline completed");
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    await failStage(currentStage, msg);
    await updateRun(runId, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: msg,
    });
    logger.error({ runId, projectId, failedStage: currentStage, err: msg }, "Production pipeline failed");
  }
}

// ================================================================
// waitForJob — poll a productionEngine job until terminal
// ================================================================

async function waitForJob(jobId: string, timeoutMs = 150 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getProductionJob(jobId);
    if (!job) throw new Error(`job ${jobId} disappeared`);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`job ${jobId} timed out after ${timeoutMs}ms`);
}

// ================================================================
// Boot recovery — mark stale FULL_PIPELINE runs as failed
// ================================================================

async function recoverStalePipelineRuns(): Promise<void> {
  try {
    const stale = await db
      .select()
      .from(productionPipeline)
      .where(and(
        eq(productionPipeline.status, "processing"),
        eq(productionPipeline.type, "FULL_PIPELINE"),
      ));
    for (const r of stale) {
      // KAYAN-TASK-32: mark as 'interrupted' instead of 'failed'.
      // Completed stages + child jobs are preserved; a future TASK-33
      // resume endpoint will continue from the last completed stage.
      await updateRun(r.id, {
        status: "interrupted",
        errorMessage: "recovered: API restart during pipeline execution (interrupted, resumable)",
      });
      logger.warn({ runId: r.id }, "Recovered stale pipeline run → interrupted (API restart)");
    }
  } catch (e) {
    logger.warn({ err: e }, "recoverStalePipelineRuns failed");
  }
}

void recoverStalePipelineRuns();

// ================================================================
// Routes
// ================================================================

router.post(["/", "/start", "/run"], requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const payload = req.body || {};
  const projectId = Number(payload.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "valid projectId is required" });
    return;
  }

  const runId = `pipe_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  await db.insert(productionPipeline).values({
    id: runId,
    projectId,
    jobId: runId,
    type: "FULL_PIPELINE",
    status: "pending",
    progress: 0,
    payload: { input: { ...payload, projectId }, stages: emptyStages() },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  setImmediate(() => { void executePipeline(runId, { projectId, ...payload }); });

  res.status(202).json({
    success: true,
    pipelineId: runId,
    status: "pending",
    progress: 0,
    projectId,
  });
});

router.get(["/list", "/all"], async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(productionPipeline)
    .orderBy(desc(productionPipeline.createdAt))
    .limit(50);
  res.json({ total: rows.length, runs: rows });
});

router.get(["/status/:id", "/:id/status", "/:id"], async (req: Request, res: Response): Promise<void> => {
  const runId = String(req.params.id);
  const row = await readRun(runId);
  if (!row) {
    res.status(404).json({ error: `Pipeline ${runId} not found` });
    return;
  }
  const payload = (row.payload ?? {}) as any;
  res.json({
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    progress: row.progress,
    currentStage: payload.currentStage ?? null,
    stages: payload.stages ?? null,
    output: row.output ?? null,
    error: row.errorMessage ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
});

export default router;
