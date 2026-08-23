import { Router, type IRouter } from "express";
import { db, actorsTable, characterReferencesTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// دالة فحص وتصحيح الروابط لضمان عدم استخدام روابط صفحات ImgBB الوهمية
function cleanImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // إذا كان الرابط يؤدي إلى صفحة ImgBB وليس الصورة المباشرة
  if (trimmed.includes("ibb.co") && !trimmed.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
    // نرفض الروابط غير المباشرة لمنع الأخطاء ونعيدها null ليعرض التطبيق الـ Placeholder
    return null; 
  }
  return trimmed;
}

// 1. جلب قائمة الممثلين الأساسية مع تنظيف الروابط الوهمية ديناميكياً
router.get("/actors", async (req, res): Promise<void> => {
  const typeFilter = req.query["type"] as string | undefined;
  const categoryFilter = req.query["category"] as string | undefined;

  const actors = categoryFilter
    ? await db.select().from(actorsTable).where(eq(actorsTable.category, categoryFilter))
    : typeFilter
      ? await db.select().from(actorsTable).where(eq(actorsTable.type, typeFilter))
      : await db.select().from(actorsTable).orderBy(actorsTable.id);

  // معالجة البيانات لضمان أن الشخصيات 27 و 28 و 29 وأي رابط وهمي يعود كـ NULL
  const sanitizedActors = actors.map(actor => ({
    ...actor,
    imageUrl: [27, 28, 29].includes(actor.id) ? null : cleanImageUrl(actor.imageUrl)
  }));

  res.json(ListActorsResponse.parse(sanitizedActors));
});

// 2. [GET] جلب مراجع وصور شخصية معينة
router.get("/actors/:actorId/references", async (req, res): Promise<void> => {
  const actorId = parseInt(req.params.actorId, 10);
  if (isNaN(actorId)) {
    res.status(400).json({ error: "Invalid actorId" });
    return;
  }
  const refs = await db
    .select()
    .from(characterReferencesTable)
    .where(eq(characterReferencesTable.actorId, actorId))
    .orderBy(characterReferencesTable.id);
  res.json(refs);
});

// 3. [POST] إضافة صورة مرجعية جديدة للشخصية مع فحص الرابط المباشر
router.post("/actors/:actorId/references", async (req, res): Promise<void> => {
  const actorId = parseInt(req.params.actorId, 10);
  const { assetUrl, referenceType, isPrimary, projectId, metadata } = req.body;

  if (isNaN(actorId) || !assetUrl) {
    res.status(400).json({ error: "actorId and assetUrl are required" });
    return;
  }

  const sanitizedUrl = cleanImageUrl(assetUrl);
  if (!sanitizedUrl) {
    res.status(400).json({ error: "Direct Image URL is required. Do not use ibb.co page links." });
    return;
  }

  if (isPrimary) {
    await db
      .update(characterReferencesTable)
      .set({ isPrimary: false })
      .where(eq(characterReferencesTable.actorId, actorId));
  }

  const [newRef] = await db
    .insert(characterReferencesTable)
    .values({
      actorId,
      projectId: projectId ? parseInt(projectId, 10) : null,
      assetUrl: sanitizedUrl,
      referenceType: referenceType || "image",
      isPrimary: !!isPrimary,
      metadata: metadata || {},
    })
    .returning();

  res.status(201).json(newRef);
});

// 4. [DELETE] حذف صورة مرجعية
router.delete("/references/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid reference id" });
    return;
  }
  await db.delete(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  res.sendStatus(204);
});

// 5. [PATCH] تعيين صورة معينة كـ Primary
router.patch("/references/:id/primary", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid reference id" });
    return;
  }
  const [target] = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Reference not found" });
    return;
  }
  await db.update(characterReferencesTable).set({ isPrimary: false }).where(eq(characterReferencesTable.actorId, target.actorId));
  const [updated] = await db.update(characterReferencesTable).set({ isPrimary: true }).where(eq(characterReferencesTable.id, id)).returning();
  res.json(updated);
});

export default router;

