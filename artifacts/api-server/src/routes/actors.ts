import { Router, type IRouter } from "express";
import { db, actorsTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// 1. جلب قائمة الشخصيات مع الفلترة
router.get("/actors", async (req, res): Promise<void> => {
  try {
    const typeFilter = req.query["type"] as string | undefined;
    const categoryFilter = req.query["category"] as string | undefined;
    
    const actors = categoryFilter
      ? await db.select().from(actorsTable).where(eq(actorsTable.category, categoryFilter))
      : typeFilter
        ? await db.select().from(actorsTable).where(eq(actorsTable.type, typeFilter))
        : await db.select().from(actorsTable).orderBy(actorsTable.id);
        
    res.json(ListActorsResponse.parse(actors));
  } catch (error: any) {
    res.status(500).json({ error: "فشل جلب الشخصيات", message: error.message });
  }
});

// 2. جلب تفاصيل شخصية معينة (Character Bible)
router.get("/actors/:id", async (req, res): Promise<void> => {
  try {
    const actorId = parseInt(req.params.id);
    const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
    
    if (!actor) {
      res.status(404).json({ error: "الشخصية غير موجودة" });
      return;
    }
    res.json(actor);
  } catch (error: any) {
    res.status(500).json({ error: "فشل جلب تفاصيل الشخصية", message: error.message });
  }
});

// 3. إنشاء شخصية جديدة وضبط حقول الـ Bible المبدئية
router.post("/actors", async (req, res): Promise<void> => {
  try {
    const { 
      name, type, category, age, style, imageUrl, 
      gender, clothingPrompt, physicalDescription, personalityTraits, backstory,
      faceReferenceUrl, visualReferenceUrl, voiceId, voiceProvider 
    } = req.body;

    const [newActor] = await db.insert(actorsTable).values({
      name, type, category: category || "global", age: parseInt(age) || 30, style: style || "cinematic", imageUrl,
      gender, clothingPrompt, physicalDescription, personalityTraits, backstory,
      faceReferenceUrl, visualReferenceUrl, voiceId, voiceProvider
    }).returning();

    res.status(201).json(newActor);
  } catch (error: any) {
    res.status(500).json({ error: "فشل إنشاء الشخصية في الـ Bible", message: error.message });
  }
});

// 4. تحديث تفاصيل الـ Character Bible (الملابس، الوجه، الصوت، إلخ) لضمان الاستمرارية
router.patch("/actors/:id", async (req, res): Promise<void> => {
  try {
    const actorId = parseInt(req.params.id);
    const updatedData = req.body;

    const [updatedActor] = await db
      .update(actorsTable)
      .set({
        ...updatedData,
        age: updatedData.age ? parseInt(updatedData.age) : undefined
      })
      .where(eq(actorsTable.id, actorId))
      .returning();

    if (!updatedActor) {
      res.status(404).json({ error: "الشخصية غير موجودة لتحديثها" });
      return;
    }
    res.json(updatedActor);
  } catch (error: any) {
    res.status(500).json({ error: "فشل تحديث بيانات الـ Bible للشخصية", message: error.message });
  }
});

// 5. حذف شخصية من الـ Bible
router.delete("/actors/:id", async (req, res): Promise<void> => {
  try {
    const actorId = parseInt(req.params.id);
    await db.delete(actorsTable).where(eq(actorsTable.id, actorId));
    res.sendStatus(204);
  } catch (error: any) {
    res.status(500).json({ error: "فشل حذف الشخصية", message: error.message });
  }
});

export default router;
