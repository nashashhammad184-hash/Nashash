/**
 * KAYAN-GUARD-29: POST /api/render/merge
 * Validates { projectId, clips[], timelineSubs }, checks ownership vs shots,
 * converts subs to SRT, creates render_job (QUEUED), schedules async render.
 * Response: 202 { success, jobId, status: "QUEUED" } — caller must poll status.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import { createRenderJob, runRenderPipeline, type RenderClipInput } from "../lib/renderEngine";
import { generateSRT, type SubtitleItem } from "../lib/subtitleService";
import { requireProductionAuth } from "../lib/securityMiddleware";

function _parseHHMMSS(v: string | undefined | null): number {
  if (!v || typeof v !== "string") return NaN;
  const m = v.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) : 0;
  return h * 3600 + min * 60 + sec + ms / 1000;
}

export function parseTimelineSubsToSRT(
  subs: Array<{ index?: number; start?: string; end?: string; text?: string }> | undefined | null,
): string | undefined {
  if (!Array.isArray(subs) || subs.length === 0) return undefined;
  const items: SubtitleItem[] = [];
  for (let i = 0; i < subs.length; i++) {
    const raw = subs[i];
    if (!raw) continue;
    const text = String(raw.text ?? "").trim();
    if (!text) continue;
    const startTime = _parseHHMMSS(raw.start);
    const endTime = _parseHHMMSS(raw.end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    if (endTime <= startTime) continue;
    items.push({
      orderIndex: typeof raw.index === "number" ? raw.index : i,
      startTime,
      endTime,
      text,
    });
  }
  if (items.length === 0) return undefined;
  return generateSRT(items);
}

export interface MergeRequestInput {
  projectId: number;
  clips: RenderClipInput[];
  timelineSubs?: Array<{ index?: number; start?: string; end?: string; text?: string }>;
  audioUrl?: string;
  watermarkText?: string;
}

export interface MergeDeps {
  getShots: (projectId: number) => Promise<Array<{ videoUrl: string | null }>>;
  createJob: typeof createRenderJob;
  scheduleRender: (jobId: string) => void;
}

export type MergeResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string; detail?: string };

export async function executeMerge(input: MergeRequestInput, deps: MergeDeps): Promise<MergeResult> {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "INVALID_BODY" };
  }
  const projectId = Number(input.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, status: 400, error: "INVALID_PROJECT_ID" };
  }
  const clips = Array.isArray(input.clips) ? input.clips : null;
  if (!clips || clips.length === 0) {
    return { ok: false, status: 400, error: "EMPTY_CLIPS" };
  }
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c || typeof c.assetUrl !== "string" || !c.assetUrl.trim()) {
      return { ok: false, status: 400, error: "INVALID_CLIP", detail: "clip " + i + " has no assetUrl" };
    }
  }
  let shotRows: Array<{ videoUrl: string | null }>;
  try {
    shotRows = await deps.getShots(projectId);
  } catch (e: any) {
    return { ok: false, status: 500, error: "SHOTS_QUERY_FAILED", detail: e?.message };
  }
  const allowed = new Set<string>();
  for (const r of shotRows) {
    if (r && typeof r.videoUrl === "string" && r.videoUrl.trim()) allowed.add(r.videoUrl.trim());
  }
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!allowed.has(String(c.assetUrl).trim())) {
      return { ok: false, status: 403, error: "CLIP_NOT_IN_PROJECT", detail: "clip " + i + " assetUrl not linked to project " + projectId };
    }
  }
  const srt = parseTimelineSubsToSRT(input.timelineSubs);
  try {
    const job = await deps.createJob({
      projectId,
      clips,
      audioUrl: typeof input.audioUrl === "string" && input.audioUrl.trim() ? input.audioUrl.trim() : undefined,
      subtitlesText: srt,
      watermarkText: typeof input.watermarkText === "string" && input.watermarkText.trim() ? input.watermarkText.trim() : undefined,
    });
    deps.scheduleRender(job.id);
    return { ok: true, jobId: job.id };
  } catch (e: any) {
    return { ok: false, status: 500, error: "CREATE_JOB_FAILED", detail: e?.message };
  }
}

const router: IRouter = Router();

router.post("/", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const result = await executeMerge(req.body || {}, {
    getShots: async (pid: number) => {
      const rows = await db
        .select({ videoUrl: shotsTable.videoUrl })
        .from(shotsTable)
        .where(eq(shotsTable.projectId, pid));
      return rows as Array<{ videoUrl: string | null }>;
    },
    createJob: createRenderJob,
    scheduleRender: (jobId: string) => {
      setImmediate(() => {
        void runRenderPipeline(jobId);
      });
    },
  });
  if (result.ok === true) {
    res.status(202).json({ success: true, jobId: result.jobId, status: "QUEUED" });
  } else {
    res.status(result.status).json({ error: result.error, detail: result.detail });
  }
});

export default router;
