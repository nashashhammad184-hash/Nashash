import { randomUUID } from "crypto";
import { Router, type IRouter, type Request, type Response, raw as expressRaw } from "express";
import { db, actorsTable, characterReferencesTable, projectsTable, projectActorsTable, characterVoiceProfilesTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq, and, sql, desc, ne } from "drizzle-orm";
import { assertSyntheticReference } from "../lib/legalGuard";
import { loadActorImageBytes } from "../lib/actorReference";
import { generateCanonicalFaceImage } from "../lib/faceIdentity";
import { requireProductionAuth } from "../lib/securityMiddleware";
import {
  uploadReference,
  deleteReference,
  createSignedUrlsForKeys,
  generateStorageKey,
  isStoragePath,
  MAX_UPLOAD_BYTES,
  MAX_STORED_BYTES,
  MAX_OUTPUT_DIMENSION,
  MAX_INPUT_PIXELS,
  imageProcessingSemaphore,
} from "../lib/storage/actorRefsStorage";
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
  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) { res.status(404).json({ error: "ACTOR_NOT_FOUND" }); return; }
  const refs = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.actorId, actorId)).orderBy(characterReferencesTable.id);
  // Collect storage paths (non-external, non-legacy)
  const storagePaths: string[] = [];
  for (const r of refs) {
    if (isStoragePath(r.assetUrl)) storagePaths.push(r.assetUrl);
  }
  // Bulk sign (one Supabase call)
  const signedMap = storagePaths.length > 0 ? await createSignedUrlsForKeys(storagePaths) : {};
  // Replace asset_url with signed URL; keep legacy external as-is
  const enriched = refs.map((r) => {
    if (!isStoragePath(r.assetUrl)) return r; // legacy external / absolute path — as-is
    const signed = signedMap[r.assetUrl] || null;
    return { ...r, assetUrl: signed };
  });
  res.json(enriched);
});

router.post(
  "/actors/:actorId/references/upload",
  requireProductionAuth,
  expressRaw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "5mb",
    inflate: false,
  }),
  async (req: Request, res: Response): Promise<void> => {
    const actorId = parseInt(String(req.params.actorId), 10);
    if (isNaN(actorId)) { res.status(400).json({ error: "INVALID_ACTOR_ID" }); return; }

    const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
    if (!actor) { res.status(404).json({ error: "ACTOR_NOT_FOUND" }); return; }

    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) { res.status(400).json({ error: "EMPTY_BODY" }); return; }
    if (buf.length > MAX_UPLOAD_BYTES) { res.status(413).json({ error: "TOO_LARGE" }); return; }

    const referenceType = String(req.query.reference_type || "image").slice(0, 50);
    const isPrimary = String(req.query.is_primary || "false").toLowerCase() === "true";
    const projectIdRaw = req.query.project_id;
    const projectId = projectIdRaw ? parseInt(String(projectIdRaw), 10) : null;
    if (projectIdRaw && (isNaN(projectId as number) || (projectId as number) <= 0)) {
      res.status(400).json({ error: "INVALID_PROJECT_ID" }); return;
    }

    let sharp: any;
    try {
      sharp = (await import("sharp")).default;
    } catch (e: any) {
      console.error("[refs-upload] sharp unavailable");
      res.status(503).json({ error: "IMAGE_PROCESSOR_UNAVAILABLE" });
      return;
    }

    let processed: Buffer;
    let outputMime: string;
    let outputExt: string;
    await imageProcessingSemaphore.acquire();
    try {
      const image = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
      const meta = await image.metadata();
      if (!meta.width || !meta.height) { res.status(400).json({ error: "INVALID_IMAGE" }); return; }
      let pipeline = image.rotate(); // auto-orient from EXIF, then strip
      if ((meta.width || 0) > MAX_OUTPUT_DIMENSION || (meta.height || 0) > MAX_OUTPUT_DIMENSION) {
        pipeline = pipeline.resize({
          width: MAX_OUTPUT_DIMENSION,
          height: MAX_OUTPUT_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      processed = await pipeline.webp({ quality: 85 }).toBuffer();
      outputMime = "image/webp";
      outputExt = "webp";
      if (processed.length > MAX_STORED_BYTES) { res.status(413).json({ error: "PROCESSED_TOO_LARGE" }); return; }
    } catch (e: any) {
      res.status(400).json({ error: "INVALID_IMAGE", detail: String(e?.message || "").slice(0, 120) });
      return;
    } finally {
      imageProcessingSemaphore.release();
    }

    const storageKey = generateStorageKey(actorId, outputExt);

    try {
      await uploadReference(storageKey, processed, outputMime);
    } catch (e: any) {
      console.error(`[refs-upload] storage failed actorId=${actorId}`);
      res.status(503).json({ error: "STORAGE_UPLOAD_FAILED" });
      return;
    }

    try {
      if (isPrimary) {
        await db.update(characterReferencesTable)
          .set({ isPrimary: false })
          .where(eq(characterReferencesTable.actorId, actorId));
      }
      const [newRef] = await db.insert(characterReferencesTable).values({
        actorId,
        projectId,
        assetUrl: storageKey,
        referenceType,
        isPrimary,
        metadata: { mime: outputMime, size: processed.length },
      }).returning();

      const signedMap = await createSignedUrlsForKeys([storageKey]);
      const signedUrl = signedMap[storageKey] || null;
      res.status(201).json({ ...newRef, assetUrl: signedUrl, isExternal: false });
    } catch (e: any) {
      // Rollback storage to avoid orphan
      try { await deleteReference(storageKey); } catch {}
      console.error(`[refs-upload] db insert failed actorId=${actorId}`);
      res.status(500).json({ error: "DB_INSERT_FAILED" });
    }
  },
);

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
  if (isNaN(id)) { res.status(400).json({ error: "INVALID_REFERENCE_ID" }); return; }

  // 1. Pre-check (no lock): does target exist?
  const [target] = await db.select().from(characterReferencesTable).where(eq(characterReferencesTable.id, id));
  if (!target) { res.status(404).json({ error: "REFERENCE_NOT_FOUND" }); return; }

  // 2. Primary safety (no lock): if primary, require an alternative to exist
  if (target.isPrimary) {
    const siblings = await db.select({ id: characterReferencesTable.id })
      .from(characterReferencesTable)
      .where(and(
        eq(characterReferencesTable.actorId, target.actorId),
        ne(characterReferencesTable.id, id),
      ));
    if (siblings.length > 0) {
      res.status(409).json({
        error: "CANNOT_DELETE_PRIMARY",
        message: "Set another reference as primary before deleting this one.",
        alternatives: siblings.length,
      });
      return;
    }
  }

  // 3. Storage delete FIRST (so DB is never left pointing to a deleted file)
  const isInternalPath = isStoragePath(target.assetUrl);
  if (isInternalPath) {
    try {
      await deleteReference(target.assetUrl);
    } catch (e: any) {
      console.error(`[refs-delete] storage failed actorId=${target.actorId} refId=${id}`);
      res.status(503).json({ error: "STORAGE_DELETE_FAILED", retryable: true });
      return;
    }
  }

  // 4. DB delete in transaction with row lock (concurrency-safe)
  try {
    const result = await db.transaction(async (tx) => {
      const lockRes: any = await tx.execute(sql`
        SELECT id FROM character_references WHERE id = ${id} FOR UPDATE
      `);
      const lockedRows: any[] = Array.isArray(lockRes) ? lockRes : (lockRes?.rows || []);
      if (lockedRows.length === 0) return { deleted: false };
      const del = await tx.delete(characterReferencesTable).where(eq(characterReferencesTable.id, id)).returning();
      return { deleted: del.length > 0 };
    });

    if (!result.deleted) {
      // Race: row disappeared between storage delete and DB delete.
      // Storage is already gone (idempotent), so 204 is correct.
      res.status(204).send();
      return;
    }
    res.sendStatus(204);
  } catch (e: any) {
    console.error(`[refs-delete] db failed actorId=${target.actorId} refId=${id}`);
    res.status(500).json({ error: "DB_DELETE_FAILED_RETRYABLE", retryable: true });
  }
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


// --- Sprint G3: Voice DNA & Cast APIs ---

// 1. GET /actors/library
router.get("/actors/library", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const actors = await db.select({
    id: actorsTable.id, name: actorsTable.name, age: actorsTable.age,
    dialect: actorsTable.dialect, description: actorsTable.description, imageUrl: actorsTable.imageUrl,
  }).from(actorsTable).orderBy(actorsTable.name);
  res.json({ ok: true, actors });
});

// 2. GET /projects/:id/cast
router.get("/projects/:id/cast", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id));
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const cast = await db.select({
      castId: projectActorsTable.id, actorId: actorsTable.id, roleName: projectActorsTable.roleName, roleType: projectActorsTable.roleType,
      name: actorsTable.name, age: actorsTable.age, dialect: actorsTable.dialect, description: actorsTable.description, imageUrl: actorsTable.imageUrl,
      defaultVoiceId: sql<number | null>`(SELECT id FROM character_voice_profiles WHERE actor_id = ${actorsTable.id} AND (project_id = ${projectId} OR project_id IS NULL) AND is_default = TRUE ORDER BY project_id DESC NULLS LAST LIMIT 1)`,
      defaultEngine: sql<string | null>`(SELECT engine FROM character_voice_profiles WHERE actor_id = ${actorsTable.id} AND (project_id = ${projectId} OR project_id IS NULL) AND is_default = TRUE ORDER BY project_id DESC NULLS LAST LIMIT 1)`,
      voicesCount: sql<number>`(SELECT COUNT(*) FROM character_voice_profiles WHERE actor_id = ${actorsTable.id} AND (project_id = ${projectId} OR project_id IS NULL))`,
    }).from(projectActorsTable)
    .innerJoin(actorsTable, eq(projectActorsTable.actorId, actorsTable.id))
    .where(eq(projectActorsTable.projectId, projectId));
  res.json({ ok: true, cast });
});

// 3. POST /projects/:id/cast
router.post("/projects/:id/cast", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id));
  const { actorId, roleName, roleType = 'supporting' } = req.body;
  if (isNaN(projectId) || !actorId) { res.status(400).json({ error: "Invalid params" }); return; }
  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) { res.status(404).json({ error: "ACTOR_NOT_FOUND" }); return; }
  const [existing] = await db.select().from(projectActorsTable).where(and(eq(projectActorsTable.projectId, projectId), eq(projectActorsTable.actorId, actorId)));
  if (existing) { res.status(409).json({ error: "ACTOR_ALREADY_IN_CAST" }); return; }
  const [entry] = await db.insert(projectActorsTable).values({ projectId, actorId, roleName: roleName || 'شخصية', roleType }).returning();
  res.json({ ok: true, castEntry: entry });
});

// 4. DELETE /projects/:id/cast/:actorId
router.delete("/projects/:id/cast/:actorId", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id));
  const actorId = parseInt(String(req.params.actorId));
  if (isNaN(projectId) || isNaN(actorId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const checks = await db.execute(sql`
    SELECT (SELECT COUNT(*) FROM shots s JOIN character_voice_profiles cvp ON cvp.id = s.character_id WHERE cvp.actor_id = ${actorId} AND s.project_id = ${projectId}) AS shots_count,
           (SELECT COUNT(*) FROM character_references cr WHERE cr.actor_id = ${actorId}) AS refs_count`);
  const row: any = (checks as any).rows ? (checks as any).rows[0] : (checks as any)[0];
  if (parseInt(row?.shots_count || '0') > 0) { res.status(409).json({ error: "ACTOR_IN_USE_IN_SHOTS" }); return; }
  if (parseInt(row?.refs_count || '0') > 0) { res.status(409).json({ error: "ACTOR_HAS_REFERENCES" }); return; }
  await db.delete(projectActorsTable).where(and(eq(projectActorsTable.projectId, projectId), eq(projectActorsTable.actorId, actorId)));
  res.json({ ok: true, message: "أُزيل من Cast" });
});

// 5. GET /actors/:id (Details)
router.get("/actors/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const actorId = parseInt(String(req.params.id));
  if (isNaN(actorId)) { res.status(400).json({ error: "Invalid actorId" }); return; }
  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) { res.status(404).json({ error: "ACTOR_NOT_FOUND" }); return; }
  const voices = await db.select().from(characterVoiceProfilesTable).where(eq(characterVoiceProfilesTable.actorId, actorId)).orderBy(desc(characterVoiceProfilesTable.isDefault));
  const projects = await db.select({ projectId: projectActorsTable.projectId, roleName: projectActorsTable.roleName }).from(projectActorsTable).where(eq(projectActorsTable.actorId, actorId));
  res.json({ ok: true, actor, voices, projects });
});

// 6. POST /actors/:id/voice (Upload)
router.post("/actors/:id/voice", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const actorId = parseInt(String(req.params.id));
  const { projectId, audioBase64, refText, dialect, engine = 'audar_flash', makeDefault = true } = req.body;
  const shouldBeDefault = makeDefault === true;
  if (!projectId || !refText || !audioBase64) { res.status(400).json({ error: "Missing required fields" }); return; }
  if (refText.length < 5) { res.status(400).json({ error: "REF_TEXT_TOO_SHORT" }); return; }
  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) { res.status(404).json({ error: "ACTOR_NOT_FOUND" }); return; }
  const buffer = Buffer.from(audioBase64, 'base64');
  if (buffer.length > 5 * 1024 * 1024) { res.status(413).json({ error: "AUDIO_TOO_LARGE" }); return; }
  const isWav = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  const isMp3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33;
  if (!isWav && !isMp3) { res.status(400).json({ error: "INVALID_AUDIO_FORMAT" }); return; }
  
  const filename = randomUUID() + ".wav";
  const oracleUrl = process.env.ORACLE_REFS_URL || "https://kayan-audar.duckdns.org";
  const oracleToken = process.env.ORACLE_REFS_TOKEN;
  let oraclePath = "/home/ubuntu/tts-test/samples/" + filename;
  
  if (oracleToken) {
    try {
      const uploadRes = await fetch(oracleUrl + "/references/upload", {
        method: 'POST', headers: { 'Authorization': "Bearer " + oracleToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ wav_base64: audioBase64, filename, ref_text: refText }),
      });
      if (!uploadRes.ok) throw new Error("Oracle upload failed");
      const data = await uploadRes.json() as any;
      oraclePath = data.path;
    } catch (err: any) {
      res.status(502).json({ error: "ORACLE_UPLOAD_FAILED", detail: err.message }); return;
    }
  }
  
  if (shouldBeDefault) {
    await db.update(characterVoiceProfilesTable).set({ isDefault: false })
      .where(and(eq(characterVoiceProfilesTable.actorId, actorId), eq(characterVoiceProfilesTable.projectId, projectId), eq(characterVoiceProfilesTable.isDefault, true)));
  }
  
  const [voice] = await db.insert(characterVoiceProfilesTable).values({
    projectId, actorId, name: actor.name, gender: actor.gender, dialect: dialect || actor.dialect || 'أردني',
    engine, refWavPath: oraclePath, refText, isDefault: shouldBeDefault,
  }).returning();
  res.json({ ok: true, voice });
});

// 7. PATCH /actors/:id/voice/:voiceId
router.patch("/actors/:id/voice/:voiceId", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const voiceId = parseInt(String(req.params.voiceId));
  const { refText, dialect, isDefault } = req.body;
  const [current] = await db.select().from(characterVoiceProfilesTable).where(eq(characterVoiceProfilesTable.id, voiceId));
  if (!current) { res.status(404).json({ error: "VOICE_NOT_FOUND" }); return; }
  if (isDefault === true) {
    await db.update(characterVoiceProfilesTable).set({ isDefault: false })
      .where(and(eq(characterVoiceProfilesTable.actorId, current.actorId), eq(characterVoiceProfilesTable.projectId, current.projectId)));
  }
  const updates: any = {};
  if (refText) updates.refText = refText;
  if (dialect) updates.dialect = dialect;
  if (isDefault !== undefined) updates.isDefault = isDefault;
  const [updated] = await db.update(characterVoiceProfilesTable).set(updates).where(eq(characterVoiceProfilesTable.id, voiceId)).returning();
  res.json({ ok: true, voice: updated });
});

// 8. DELETE /actors/:id/voice/:voiceId
router.delete("/actors/:id/voice/:voiceId", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const voiceId = parseInt(String(req.params.voiceId));
  const usage = await db.execute(sql`SELECT COUNT(*) as count FROM shots WHERE character_id = ${voiceId}`);
  const row: any = (usage as any).rows ? (usage as any).rows[0] : (usage as any)[0];
  if (parseInt(row?.count || '0') > 0) { res.status(409).json({ error: "VOICE_IN_USE_IN_SHOTS" }); return; }
  await db.delete(characterVoiceProfilesTable).where(eq(characterVoiceProfilesTable.id, voiceId));
  res.json({ ok: true });
});

// 9. GET /actors/:id/voice/:voiceId/sample (proxy — token stays between servers)
router.get("/actors/:id/voice/:voiceId/sample", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const voiceId = parseInt(String(req.params.voiceId));
  if (isNaN(voiceId)) { res.status(400).json({ error: "INVALID_VOICE_ID" }); return; }
  const [voice] = await db.select().from(characterVoiceProfilesTable).where(eq(characterVoiceProfilesTable.id, voiceId));
  if (!voice || !voice.refWavPath) { res.status(404).json({ error: "NO_SAMPLE" }); return; }
  if (!voice.projectId && !voice.actorId) { res.status(404).json({ error: "NO_SAMPLE" }); return; }
  const basename = String(voice.refWavPath).split('/').pop();
  const isSafeWav = (n: string) =>
    !!n && n.length <= 200 && n.endsWith(".wav") &&
    !n.includes("/") && !n.includes("\\") &&
    n !== "." && n !== ".." && !n.startsWith(".") &&
    /^[a-zA-Z0-9_\-\u0600-\u06FF]+\.wav$/.test(n);
  if (!basename || !isSafeWav(basename)) { res.status(404).json({ error: "NO_SAMPLE" }); return; }
  const oracleUrl = process.env.ORACLE_REFS_URL || "https://kayan-audar.duckdns.org";
  const oracleToken = process.env.ORACLE_REFS_TOKEN;
  if (!oracleToken) { res.status(503).json({ error: "SAMPLE_UNAVAILABLE" }); return; }
  try {
    const upstream = await fetch(`${oracleUrl}/references/${basename}`, {
      headers: { "Authorization": `Bearer ${oracleToken}` },
    });
    if (!upstream.ok) {
      if (upstream.status === 404) {
        res.status(404).json({ error: "NO_SAMPLE" });
        return;
      }
      console.error(`[sample] Oracle status=${upstream.status} voiceId=${voiceId}`);
      res.status(503).json({ error: "SAMPLE_UNAVAILABLE" });
      return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=300");
    const reader = upstream.body?.getReader();
    if (!reader) { res.status(503).json({ error: "SAMPLE_UNAVAILABLE" }); return; }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error(`[sample] Fetch failed voiceId=${voiceId}`);
    if (!res.headersSent) res.status(503).json({ error: "SAMPLE_UNAVAILABLE" });
    else res.end();
  }
});

export default router;
