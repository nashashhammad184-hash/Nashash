import { Router, type IRouter, type Request, type Response } from "express";
import { db, actorsTable, characterReferencesTable, projectsTable, projectActorsTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { assertSyntheticReference } from "../lib/legalGuard";
import { loadActorImageBytes } from "../lib/actorReference";
import { generateCanonicalFaceImage } from "../lib/faceIdentity";
import { requireProductionAuth } from "../lib/securityMiddleware";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

// KAYAN-9a — DI for POST /actors create flow (defaults to real db; tests override)
const _createActorDeps: { db: any } = { db };
export function _setActorsCreateDeps(overrides: { db?: any }) {
  if (overrides.db !== undefined) _createActorDeps.db = overrides.db;
}
export function _resetActorsCreateDeps() {
  _createActorDeps.db = db;
}
// KAYAN-TASK-03 — canonical-face consumes GPU; rate limit + auth required.
const canonicalFaceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many canonical-face requests. Limit: 5 per hour per IP." },
});

function cleanImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("ibb.co") && !trimmed.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
    return null;
  }
  return trimmed;
}

// 1. GET /api/actors - جلب القائمة وتصفيتها
router.get("/actors", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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

// 2. POST /api/actors — KAYAN-9a: optional projectId links actor to project
export async function handleCreateActor(req: Request, res: Response): Promise<void> {
  try {
    const { name, type, age, style, imageUrl, category, projectId } = req.body;
    if (!name || !type || !age || !style) { res.status(400).json({ error: "MISSING_FIELDS" }); return; }
    if (projectId != null) {
      if (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "INVALID_PROJECT_ID" }); return; }
    }
    if (imageUrl != null && typeof imageUrl === "string" && imageUrl.trim() !== "") { assertSyntheticReference(imageUrl.trim(), req.body); }
    const newActor = await _createActorDeps.db.transaction(async (tx: any) => {
      if (projectId != null) {
        const projRows = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
        if (!projRows || projRows.length === 0) { const e: any = new Error("PROJECT_NOT_FOUND"); e.statusCode = 404; throw e; }
      }
      const [actor] = await tx.insert(actorsTable).values({ name: name.trim(), type: type.trim(), age: parseInt(String(age), 10) || 30, style: style.trim(), imageUrl: imageUrl ? imageUrl.trim() : null, category: category || "global", createdAt: new Date() }).returning();
      if (projectId != null) { await tx.insert(projectActorsTable).values({ projectId, actorId: actor.id, roleName: actor.name, roleType: "supporting" }); }
      return actor;
    });
    res.status(201).json(newActor);
  } catch (err: any) {
    if (err?.statusCode === 404) { res.status(404).json({ error: err.message }); return; }
    const isLegal = err?.statusCode === 400 || err?.code === "LEGAL_GUARD_NON_SYNTHETIC";
    res.status(isLegal ? 400 : 500).json({ error: "POST_ACTOR_FAIL: " + err.message });
  }
}
router.post("/actors", requireProductionAuth, handleCreateActor);

// 3. PATCH /api/actors/:id - تحديث بيانات الممثل الرقمي وأسلوب أدائه
router.patch("/actors/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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
router.delete("/actors/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
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

// KAYAN-CINEMA-17A: serve actor image bytes for UI display.
// Uses the storage layer's resolveLocal + read directly (same trust boundary
// as resolveActorReference for i2v). Does NOT use the generic
// /api/storage/supabase/* proxy (which refuses to sign actors/refs/ keys for
// security reasons). Errors are sanitized — no internal paths or secrets.
// Headers: correct Content-Type, X-Content-Type-Options: nosniff, private cache.
router.get("/actors/:actorId/image", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const actorId = parseInt(String(req.params.actorId), 10);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    res.status(400).json({ error: "actorId must be a positive integer" });
    return;
  }
  try {
    const result = await loadActorImageBytes(actorId);
    if (result.ok === false) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.setHeader("Content-Type", result.mime);
    res.setHeader("Content-Length", String(result.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="actor-${actorId}.${result.mime === "image/png" ? "png" : "jpg"}"`);
    res.status(200).end(result.buffer);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ error: "failed to serve actor image" });
    }
  }
});

// المسارات الفرعية للمراجعcharacter references
router.get("/actors/:actorId/references", requireProductionAuth, async (req, res): Promise<void> => {
  const actorId = parseInt(String(req.params.actorId), 10);
  if (isNaN(actorId)) { res.status(400).json({ error: "Invalid actorId" }); return; }
  const refs = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.actorId, actorId)).orderBy(characterReferencesTable.id);
  res.json(refs);
});

router.post("/actors/:actorId/references", requireProductionAuth, async (req, res): Promise<void> => {
  const actorId = parseInt(String(req.params.actorId), 10);
  const { assetUrl, referenceType, isPrimary, projectId, metadata } = req.body;
  if (isNaN(actorId) || !assetUrl) { res.status(400).json({ error: "actorId and assetUrl are required" }); return; }
  const sanitizedUrl = cleanImageUrl(assetUrl);
  if (!sanitizedUrl) { res.status(400).json({ error: "Direct Image URL is required." }); return; }
  // KAYAN-TASK-03 — legal guard BEFORE any DB write. No client boolean bypass.
  try {
    assertSyntheticReference(sanitizedUrl, req.body);
  } catch (err: any) {
    res.status(err?.statusCode || 400).json({ error: err?.message || "LEGAL_GUARD_REJECTED", code: err?.code });
    return;
  }
  if (isPrimary) { await db.update(characterReferencesTable).set({ isPrimary: false }).where(eq(characterReferencesTable.actorId, actorId)); }
  const [newRef] = await db.insert(characterReferencesTable).values({ actorId, projectId: projectId ? parseInt(projectId, 10) : null, assetUrl: sanitizedUrl, referenceType: referenceType || "image", isPrimary: !!isPrimary, metadata: metadata || {} }).returning();
  res.status(201).json(newRef);
});

router.delete("/references/:id", requireProductionAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid reference id" }); return; }
  await db.delete(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  res.sendStatus(204);
});

router.patch("/references/:id/primary", requireProductionAuth, async (req, res): Promise<void> => {
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
  canonicalFaceLimiter,
  requireProductionAuth,
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
