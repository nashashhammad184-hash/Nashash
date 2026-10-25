import { Router, type Request, type Response } from "express";
import { createProductionJob, getProductionJob, listProductionJobs } from "../lib/productionEngine";
import { resolveActorReference } from "../lib/actorReference";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router = Router();

// KAYAN-GUARD-13: pure validator — external video provider supports i2v only.
export function validateVideoGenForProvider(input: {
  type: string;
  resolvedTask: "t2v" | "i2v" | undefined;
  resolvedRef: string | null;
  videoProvider: string;
}): { ok: true } | { ok: false; error: string; message: string } {
  if (input.type !== "VIDEO_GEN") return { ok: true };
  if (input.videoProvider.toLowerCase() !== "external") return { ok: true };
  if (input.resolvedTask === "i2v" && input.resolvedRef && input.resolvedRef.length >= 64) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "VIDEO_I2V_REQUIRED",
    message: "External video provider supports i2v only. Provide actorId or referenceImageBase64 (>=64 chars).",
  };
}

router.get("/production/config", async (req: Request, res: Response): Promise<void> => {
  res.json({
    provider: process.env.VOICE_PROVIDER || "Deepgram",
    videoProvider: "Local-G5-GPU",
    status: "active"
  });
});

router.post("/production/jobs", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const { type, projectId, taskId, prompt, text, videoUrl, audioUrl, model,
    actorId, task, referenceImageBase64 } = req.body;
  if (!type) {
    res.status(400).json({ error: "نوع مهمة الإنتاج (type) مطلوب بشكل صريح." });
    return;
  }

  // KAYAN-CINEMA-16: for VIDEO_GEN, optionally resolve an actor reference.
  // When actorId is provided, verify it is linked to the project, load the
  // actor's reference image, and force task='i2v' + referenceImageBase64.
  // When actorId is absent, behavior is unchanged (backwards compatible).
  let resolvedTask: "t2v" | "i2v" | undefined =
    task === "i2v" ? "i2v" : task === "t2v" ? "t2v" : undefined;
  let resolvedRef: string | null =
    typeof referenceImageBase64 === "string" && referenceImageBase64.trim().length >= 64
      ? referenceImageBase64.trim()
      : null;
  let resolvedActorId: number | null = null;

  if (type === "VIDEO_GEN" && actorId !== undefined && actorId !== null && String(actorId).trim() !== "") {
    const pid = projectId ? parseInt(String(projectId), 10) : 0;
    if (!Number.isInteger(pid) || pid <= 0) {
      res.status(400).json({ error: "projectId is required when actorId is provided" });
      return;
    }
    const actorRes = await resolveActorReference({
      actorId,
      projectId: pid,
      explicitReferenceImageBase64: resolvedRef,
    });
    if (actorRes.ok === false) {
      res.status(actorRes.status).json({ error: actorRes.error });
      return;
    }
    resolvedTask = actorRes.task;
    resolvedRef = actorRes.referenceImageBase64;
    resolvedActorId = actorRes.actorId;
    console.log(`⚡ [CINEMA-16] actor ${actorId} resolved (source=${actorRes.source}, task=${actorRes.task})`);
  }

  // KAYAN-GUARD-13: fail fast BEFORE enqueue when external provider cannot do t2v.
  const vgCheck = validateVideoGenForProvider({
    type,
    resolvedTask,
    resolvedRef,
    videoProvider: process.env.VIDEO_PROVIDER || "kayangpu",
  });
  if (vgCheck.ok === false) {
    res.status(400).json({ error: vgCheck.error, message: vgCheck.message });
    return;
  }
  try {
    console.log(`⚡ [Production Pipeline] إطلاق مَهمة إنتاج حية من نوع [${type}] للمشروع رقم #${projectId || 'N/A'}`);
    const job = await createProductionJob(type, {
      projectId: projectId ? parseInt(String(projectId), 10) : undefined,
      taskId: taskId ? parseInt(String(taskId), 10) : undefined,
      prompt, text, videoUrl, audioUrl, model,
      task: resolvedTask,
      referenceImageBase64: resolvedRef ?? undefined,
      actorId: resolvedActorId ?? undefined,
    });
    res.status(202).json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ error: "فشل حقن المهمة في محرك التوليد", message: error.message });
  }
});

router.get("/production/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params.id);
  try {
    const job = await getProductionJob(jobId);
    if (!job) {
      res.status(404).json({ error: "مَهمة الإنتاج المطلوبة غير موجودة في قاعدة البيانات حالياً." });
      return;
    }
    res.json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ error: "فشل تتبع حالة المهمة", message: error.message });
  }
});

router.get("/production/projects/:projectId/jobs", async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.projectId), 10);
  try {
    const jobs = await listProductionJobs(isNaN(projectId) ? undefined : projectId);
    res.json({ success: true, jobs });
  } catch (error: any) {
    res.status(500).json({ error: "فشل جلب مهام المشروع", message: error.message });
  }
});

export default router;
