import { Router, type IRouter } from "express";
import { db, scriptsTable, shotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ProductionPromptBuilder } from "../services/promptBuilder";

const router: IRouter = Router();

// دالة توليد موجه إنتاجي احترافي مجمع للأركان العشرة بالكامل (إصلاح 13)
async function fallbackProductionPrompt(shot: any, scriptContext?: string, projectId?: number | null): Promise<string> {
  // تجميع المدخلات المتاحة من اللقطة الحالية وتمريرها للخدمة الموحدة والمستقلة
  return await ProductionPromptBuilder.build({
    sceneDescription: scriptContext || shot.description || "Cinematic Scene Context",
    shotDescription: shot.description,
    cameraMovement: shot.cameraMovement || "Static Cinematic Shot",
    lighting: shot.lighting || "Cinematic Natural Lighting",
    microExpression: shot.microExpression || "Neutral Realism",
    dialogue: shot.dialogue,
    actorId: shot.actorId || null,
    projectId: projectId || null
  });
}

// 1. جلب السيناريو مع كامل تفاصيله ولقطاته والـ Prompts الإنتاجية المجمعة
router.get("/scripts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  const [script] = await db.select().from(scriptsTable).where(eq(scriptsTable.id, id));
  if (!script) {
    res.status(404).json({ error: "Script not found" });
    return;
  }

  const shots = await db.select().from(shotsTable).where(eq(shotsTable.scriptId, id));

  // معالجة اللقطات وحقن الـ Production Prompt الفاخر والشامل والموحد لكل لقطة سينمائية
  const detailedShots = await Promise.all(
    shots.map(async (shot) => {
      const prompt = await fallbackProductionPrompt(shot, script.content, script.projectId);
      return {
        ...shot,
        productionPrompt: prompt,
      };
    })
  );

  res.json({
    ...script,
    shots: detailedShots,
  });
});

export default router;
