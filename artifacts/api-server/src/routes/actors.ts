import { Router, type IRouter, type Request, type Response } from "express";
import { db, actorsTable, characterReferencesTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { assertSyntheticReference } from "../lib/legalGuard";
import { generateCanonicalFaceImage } from "../lib/faceIdentity";

const router: IRouter = Router();

function cleanImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("ibb.co") && !trimmed.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
    return null;
  }
  return trimmed;
}

// 1. GET /api/actors - جلب القائمة وتصفيتها
router.get("/actors", async (req: Request, res: Response): Promise<void> => {
  try {
    const typeFilter = req.query["type"] as string | undefined;
    const categoryFilter = req.query["category"] as string | undefined;
    
    const actors = categoryFilter
      ? await db.select().from(actorsTable).where(eq(actorsTable.category, categoryFilter))
      : typeFilter && typeFilter !== "الكل"
        ? await db.select().from(actorsTable).where(eq(actorsTable.type, typeFilter))
        : await db.select().from(actorsTable).orderBy(actorsTable.id);
        
    const sanitizedActors = actors.map(actor => ({
      ...actor,
      imageUrl: cleanImageUrl(actor.imageUrl)
    }));
    
    res.json(sanitizedActors);
  } catch (err: any) {
    res.status(500).json({ error: "فشل جلب الممثلين: " + err.message });
  }
});

// 2. POST /api/actors - إنشاء ممثل رقمي جديد حقيقي داخل PostgreSQL
router.post("/actors", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, age, style, imageUrl, category } = req.body;
    if (!name || !type || !age || !style) {
      res.status(400).json({ error: "جميع الحقول الأساسية (الاسم، النوع، العمر، أسلوب الأداء) مطلوبة." });
      return;
    }
    if (imageUrl != null && typeof imageUrl === "string" && imageUrl.trim() !== "") {
      assertSyntheticReference(imageUrl.trim(), req.body);
    }
    const [newActor] = await db.insert(actorsTable).values({
      name: name.trim(),
      type: type.trim(),
      age: parseInt(String(age), 10) || 30,
      style: style.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : null,
      category: category || "global",
      createdAt: new Date()
    }).returning();
    res.status(201).json(newActor);
  } catch (err: any) {
    const isLegal = err?.statusCode === 400 || err?.code === "LEGAL_GUARD_NON_SYNTHETIC";
    res.status(isLegal ? 400 : 500).json({ error: "فشل إنشاء الممثل داخل PostgreSQL: " + err.message });
  }
});

// 3. PATCH /api/actors/:id - تحديث بيانات الممثل الرقمي وأسلوب أدائه
router.patch("/actors/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "معرف الممثل غير صالح." });
      return;
    }
    const { name, type, age, style, imageUrl } = req.body;
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (type !== undefined) updateData.type = type.trim();
    if (age !== undefined) updateData.age = parseInt(String(age), 10) || 30;
    if (style !== undefined) updateData.style = style.trim();
    if (imageUrl !== undefined) {
      if (imageUrl != null && typeof imageUrl === "string" && imageUrl.trim() !== "") {
        assertSyntheticReference(imageUrl.trim(), req.body);
      }
      updateData.imageUrl = imageUrl ? imageUrl.trim() : null;
    }

    const [updatedActor] = await db.update(actorsTable)
      .set(updateData)
      .where(eq(actorsTable.id, id))
      .returning();
      
    if (!updatedActor) {
      res.status(404).json({ error: "الممثل الرقمي غير موجود للتعديل." });
      return;
    }
    res.json(updatedActor);
  } catch (err: any) {
    const isLegal = err?.statusCode === 400 || err?.code === "LEGAL_GUARD_NON_SYNTHETIC";
    res.status(isLegal ? 400 : 500).json({ error: "فشل تعديل الممثل داخل PostgreSQL: " + err.message });
  }
});

// 4. DELETE /api/actors/:id - الحذف الحقيقي والنهائي للممثل الرقمي من الـ DB
router.delete("/actors/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "معرف الممثل غير صالح." });
      return;
    }
    const [deleted] = await db.delete(actorsTable).where(eq(actorsTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "الممثل غير موجود لحذفه." });
      return;
    }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: "فشل الحذف من PostgreSQL: " + err.message });
  }
});

// المسارات الفرعية للمراجعcharacter references
router.get("/actors/:actorId/references", async (req, res): Promise<void> => {
  const actorId = parseInt(req.params.actorId, 10);
  if (isNaN(actorId)) { res.status(400).json({ error: "Invalid actorId" }); return; }
  const refs = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.actorId, actorId)).orderBy(characterReferencesTable.id);
  res.json(refs);
});

router.post("/actors/:actorId/references", async (req, res): Promise<void> => {
  const actorId = parseInt(req.params.actorId, 10);
  const { assetUrl, referenceType, isPrimary, projectId, metadata } = req.body;
  if (isNaN(actorId) || !assetUrl) { res.status(400).json({ error: "actorId and assetUrl are required" }); return; }
  const sanitizedUrl = cleanImageUrl(assetUrl);
  if (!sanitizedUrl) { res.status(400).json({ error: "Direct Image URL is required." }); return; }
  if (isPrimary) { await db.update(characterReferencesTable).set({ isPrimary: false }).where(eq(characterReferencesTable.actorId, actorId)); }
  const [newRef] = await db.insert(characterReferencesTable).values({ actorId, projectId: projectId ? parseInt(projectId, 10) : null, assetUrl: sanitizedUrl, referenceType: referenceType || "image", isPrimary: !!isPrimary, metadata: metadata || {} }).returning();
  res.status(201).json(newRef);
});

router.delete("/references/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid reference id" }); return; }
  await db.delete(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  res.sendStatus(204);
});

router.patch("/references/:id/primary", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid reference id" }); return; }
  const [target] = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  if (!target) { res.status(404).json({ error: "Reference not found" }); return; }
  await db.update(characterReferencesTable).set({ isPrimary: false }).where(eq(characterReferencesTable.actorId, target.actorId));
  const [updated] = await db.update(characterReferencesTable).set({ isPrimary: true }).where(eq(characterReferencesTable.id, id)).returning();
  res.json(updated);
});


// KAYAN-FIX-06 — canonical face generation endpoint.
router.post(
  "/actors/:actorId/canonical-face",
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.actorId);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid actorId" });
      return;
    }
    try {
      const result = await generateCanonicalFaceImage(id);
      res.status(201).json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || "canonical face failed" });
    }
  },
);

export default router;
