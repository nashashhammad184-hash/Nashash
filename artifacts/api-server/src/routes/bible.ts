import { Router, type Request, type Response } from "express";
import { db, actorsTable, worldProfilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// 1. GET /api/projects/:id/world-bible - جلب ميثاق العالم الخاص بالمشروع حقيقياً
router.get("/projects/:id/world-bible", async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(String(req.params.id)), 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "معرف المشروع غير صالح." });
    return;
  }
  try {
    const existing = await db
      .select()
      .from(worldProfilesTable)
      .where(eq(worldProfilesTable.projectId, projectId))
      .limit(1);

    if (existing.length > 0) {
      res.json({ success: true, worldBible: existing[0] });
    } else {
      res.json({ success: true, worldBible: null });
    }
  } catch (error: any) {
    res.status(500).json({ error: "فشل جلب الـ World Bible من قاعدة البيانات", message: error.message });
  }
});

// 2. POST /api/projects/:id/world-bible - حفظ وتحديث ميثاق الإنتاج (Upsert Logic) بداخل PostgreSQL
router.post("/projects/:id/world-bible", async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(String(req.params.id)), 10);
  const { 
    worldId, era, location, geography, architecture, clothingStyle, 
    technology, lighting, colorPalette, atmosphere, weather, visualStyle, 
    masterPrompt, negativePrompt 
  } = req.body;

  if (isNaN(projectId)) {
    res.status(400).json({ error: "معرف المشروع مطلوب وصالح." });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(worldProfilesTable)
      .where(eq(worldProfilesTable.projectId, projectId))
      .limit(1);

    const biblePayload = {
      projectId,
      name: worldId || "default_world",
      description: atmosphere || "Cinematic Studio Atmosphere",
      era: era || null,
      location: location || null,
      geography: geography || null,
      architecture: architecture || null,
      clothingStyle: clothingStyle || null,
      technologyLevel: technology || null,
      weather: weather || null,
      lighting: lighting || null,
      colorPalette: colorPalette || null,
      atmosphere: atmosphere || null,
      visualStyle: visualStyle || null,
      masterPrompt: masterPrompt || null,
      negativePrompt: negativePrompt || null,
      updatedAt: new Date()
    };

    if (existing.length > 0) {
      console.log(`⚡ [PostgreSQL UPDATE] جاري تحديث الـ World Bible للمشروع رقم #${projectId}`);
      const [updated] = await db
        .update(worldProfilesTable)
        .set(biblePayload)
        .where(eq(worldProfilesTable.id, existing[0].id))
        .returning();
      res.json({ success: true, worldBible: updated });
    } else {
      console.log(`⚡ [PostgreSQL INSERT] جاري إنشاء الـ World Bible لأول مرة للمشروع رقم #${projectId}`);
      const [created] = await db
        .insert(worldProfilesTable)
        .values(biblePayload)
        .returning();
      res.status(201).json({ success: true, worldBible: created });
    }
  } catch (error: any) {
    console.error("🚨 خطأ أثناء حفظ الـ World Bible:", error.message);
    res.status(500).json({ error: "فشل حفظ ميثاق العالم في قاعدة البيانات", message: error.message });
  }
});

// المسار القديم للأطباق المحدثة للممثلين
router.patch("/actors/:id/bible", async (req: Request, res: Response): Promise<void> => {
  const actorId = parseInt(String(String(req.params.id)), 10);
  if (isNaN(actorId)) { res.status(400).json({ error: "Invalid Actor ID" }); return; }
  try {
    const [updated] = await db.update(actorsTable).set({
      role: req.body.role, gender: req.body.gender, personality: req.body.personality,
      background: req.body.background, behavior: req.body.behavior, speakingStyle: req.body.speakingStyle,
      appearance: req.body.appearance || {}, wardrobe: req.body.wardrobe || {},
      characterPrompt: req.body.characterPrompt, negativePrompt: req.body.negativePrompt,
      referenceImages: req.body.referenceImages || [], voiceId: req.body.voiceId,
      voiceSettings: req.body.voiceSettings || { stability: 0.75, clarity: 0.75 }
    }).where(eq(actorsTable.id, actorId)).returning();
    if (!updated) { res.status(404).json({ error: "Actor not found" }); return; }
    res.json({ success: true, actor: updated });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

export default router;
