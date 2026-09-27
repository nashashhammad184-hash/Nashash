import { Router, Request, Response } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, projectsTable, scriptsTable, shotsTable, projectActorsTable, actorsTable, worldProfilesTable } from "@workspace/db";
import { ListProjectScriptsParams, ListProjectScriptsResponse, GenerateScriptBody, GenerateScriptResponse } from "@workspace/api-zod";
import { generateScript } from "../lib/scriptGenerator";
import { GpuQueueService } from "../lib/services/GpuQueueService";
import { requireProductionAuth } from "../lib/securityMiddleware";

const router = Router();

// 1. GET /api/projects/:id/scripts - جلب مسودات السيناريو السابقة للمشروع الصحيح
router.get("/projects/:id/scripts", async (req: Request, res: Response): Promise<void> => {
  const params = ListProjectScriptsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const scripts = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.projectId, params.data.id))
      .orderBy(desc(scriptsTable.createdAt));
      
    res.json(scripts);
  } catch (err: any) {
    res.status(500).json({ error: "فشل جلب مسودات السيناريو: " + err.message });
  }
});

// 2. POST /api/scripts/generate — production script generation via Local GPU LLM (vLLM + Qwen2.5-7B-AWQ @ 127.0.0.1:8082). Groq is legacy and not used in production.
router.post("/scripts/generate", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateScriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, idea, worldId } = parsed.data;

  try {
    console.log(`⚡ [Writing Pipeline] جاري سحب قيود الممثلين والميثاق للمشروع رقم #${projectId}...`);
    
    // سحب طاقم الممثلين المعينين للمشروع حقيقياً من قاعدة البيانات
    const assignedActors = await db
      .select({
        id: actorsTable.id,
        name: actorsTable.name,
        type: actorsTable.type,
        age: actorsTable.age,
        style: actorsTable.style,
        role: projectActorsTable.roleName,
        personality: actorsTable.personality,
        appearance: actorsTable.appearance,
        wardrobe: actorsTable.wardrobe,
        characterPrompt: actorsTable.characterPrompt
      })
      .from(projectActorsTable)
      .innerJoin(actorsTable, eq(projectActorsTable.actorId, actorsTable.id))
      .where(eq(projectActorsTable.projectId, projectId));

    // سحب ميثاق العالم (World Bible) للمشروع الحالي لتغذية محرك التوليد
    const [worldBibleRecord] = await db
      .select()
      .from(worldProfilesTable)
      .where(eq(worldProfilesTable.projectId, projectId))
      .limit(1);

    console.log(`🤖 [Local GPU LLM] dispatching LLM_JOB to Kayan LLM worker (KAYAN_LLM_URL) with ${assignedActors.length} actors in the script payload...`);
    
    // KAYAN 52741: Queue-based execution
    const enq = await GpuQueueService.enqueue('LLM_JOB', {
      script_payload: {
        projectId,
        idea,
        worldId,
        actors: assignedActors as any,
        worldBible: worldBibleRecord as any,
      },
    });
    console.log(`⚡ [GPU Queue] LLM_JOB enqueued: ${enq.id}`);

    // محاولة الانتظار المختصر (8s) للحفاظ على السلوك المتزامن للـ UI
    const SYNC_WAIT_MS = 8000;
    const deadline = Date.now() + SYNC_WAIT_MS;
    let finalJob = null;
    while (Date.now() < deadline) {
      const j = await GpuQueueService.getJob(enq.id);
      if (j && (j.status === 'COMPLETED' || j.status === 'FAILED')) { finalJob = j; break; }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!finalJob || finalJob.status !== 'COMPLETED') {
      // async fallback — UI يجب أن تعرف أنها QUEUED وليس FAILED
      res.status(202).json({
        jobId: enq.id,
        status: finalJob?.status ?? 'QUEUED',
        message: 'GPU busy — request queued. Poll /api/jobs/{jobId} for status.',
      });
      return;
    }

    // اكتمل — بنفس شكل الاستجابة القديمة
    const scriptResult = (finalJob.result as any) || {};
    const script = { id: scriptResult.scriptId, projectId, idea, worldId, generatedContent: scriptResult.text };
    if (!script) {
      res.status(500).json({ error: "فشل حفظ نص السيناريو التوليدي داخل قاعدة البيانات." });
      return;
    }
    console.log(`✅ [GPU Queue] scriptId=${script.id}, shots=${scriptResult.shotsInserted ?? 0}`);
    res.status(201).json(script);
    return;
  } catch (err: any) {
    console.error("🚨 خطأ كارثي في خط إنتاج الكتابة الذكية:", err.message);
    res.status(502).json({ error: "Script generation failed: Local GPU LLM (Kayan LLM worker) did not produce a script. No fallback provider is configured.", message: err.message });
  }
});

// جلب برومبت الإنتاج المترجم للقطات
router.get("/projects/:id/production-prompt", async (req: Request, res: Response): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "A valid project id is required." });
    return;
  }
  try {
    const shots = await db
      .select()
      .from(shotsTable)
      .where(eq(shotsTable.projectId, projectId))
      .orderBy(asc(shotsTable.sceneNumber));
      
    if (shots.length === 0) {
      res.json({ prompt: "", source: "fallback" });
      return;
    }
    
    const sourcePrompt = shots.map(s => `Scene ${s.sceneNumber}. Visual: ${s.description}. Camera: ${s.cameraMovement}`).join("\n");
    res.json({ prompt: sourcePrompt, source: "director" });
  } catch {
    res.json({ prompt: "", source: "fallback" });
  }
});


// مسار جلب خطة الإنتاج الكاملة للعقد الإلزامي (KAYAN-PROD-02)
router.get("/projects/:id/production-plan", async (req: Request, res: Response): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "معرف المشروع غير صالح." });
    return;
  }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) {
      res.status(404).json({ error: "المشروع غير موجود." });
      return;
    }
    const [world] = await db.select().from(worldProfilesTable).where(eq(worldProfilesTable.projectId, projectId)).limit(1);
    const actors = await db.select({ name: actorsTable.name, role: projectActorsTable.roleName })
      .from(projectActorsTable)
      .innerJoin(actorsTable, eq(projectActorsTable.actorId, actorsTable.id))
      .where(eq(projectActorsTable.projectId, projectId));

    const shots = await db.select().from(shotsTable).where(eq(shotsTable.projectId, projectId)).orderBy(asc(shotsTable.shotOrder), asc(shotsTable.id));

    const productionPlan = shots.map((s, idx) => {
      const order = s.shotOrder ?? (idx + 1);
      const camPart = s.cameraMovement ? `[Camera: ${s.cameraMovement}] ` : "";
      const charPart = actors.length ? `[Character: ${actors[0].name}] ` : "";
      const actPart = s.description ? `Action: ${s.description}. ` : "";
      const dialPart = s.dialogue ? `Dialogue Mood: "${s.dialogue}". ` : "";
      const visualPrompt = `${world?.visualStyle || "Cinematic film still, high production value."} ${camPart}${charPart}${actPart}${dialPart}`.trim();

      return {
        shot_id: s.id,
        scene_id: s.sceneNumber,
        episode_id: s.episode_number || "1",
        order,
        characters: actors.map(a => a.name),
        world: project.worldId,
        action: s.description,
        dialogue: s.dialogue,
        camera: s.cameraMovement,
        direction: s.audioNote,
        visual_prompt: visualPrompt,
        duration: s.durationSeconds,
        status: s.status || "PLAN_READY"
      };
    });

    res.json({
      success: true,
      projectId,
      totalShots: productionPlan.length,
      plan: productionPlan
    });
  } catch (err: any) {
    res.status(500).json({ error: "فشل استخراج خطة الإنتاج: " + err.message });
  }
});


// KAYAN 52741 — حالة أي GPU job
router.get("/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const j = await GpuQueueService.getJob(String(req.params.id));
    if (!j) { res.status(404).json({ error: "job_not_found" }); return; }
    res.json({
      jobId: j.id,
      kind: j.kind,
      status: j.status,
      result: j.result,
      error: j.error,
      createdAt: j.created_at,
      startedAt: j.started_at,
      finishedAt: j.finished_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "internal" });
  }
});

export default router;
