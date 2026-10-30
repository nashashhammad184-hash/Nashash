import { Router, Request, Response } from "express";
import { requireProductionAuth } from "../lib/securityMiddleware";
import { db } from "@workspace/db";
import { projectsTable, projectActorsTable, actorsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { UpdateProjectBody } from "@workspace/api-zod";

const router = Router();

// KI-004 — DI for GET /projects/:id/actors (tests override)
const _projectsDeps: { db: any } = { db };
export function _setProjectsDeps(o: { db?: any }) { if (o.db !== undefined) _projectsDeps.db = o.db; }
export function _resetProjectsDeps() { _projectsDeps.db = db; }

router.get("/", requireProductionAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const allProjects = await db.select().from(projectsTable);
    res.json(allProjects);
  } catch (err: any) {
    res.status(500).json({ error: "فشل في جلب المشاريع: " + err.message });
  }
});

router.get("/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(String(String(req.params.id)), 10);
  if (isNaN(numericId)) { res.status(400).json({ error: "معرف غير صالح." }); return; }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, numericId));
    if (!project) { res.status(404).json({ error: "المشروع غير موجود." }); return; }
    res.json(project);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, synopsis, worldId, projectType, style } = req.body;
    if (!title) { res.status(400).json({ error: "عنوان المشروع مطلوب." }); return; }
    const [newProject] = await db.insert(projectsTable).values({
      title: title.trim(), synopsis: synopsis ? synopsis.trim() : null,
      worldId: worldId || "drama", projectType: projectType || "film", style: style || "drama",
      status: "pre_production", isArchived: false, updatedAt: new Date()
    }).returning();
    res.status(201).json(newProject);
  } catch (err: any) { res.status(500).json({ error: "فشل الحفظ: " + err.message }); }
});

// KI-004 — GET /api/projects/:id/actors (list assigned actors with details)
export async function listProjectActorsHandler(req: Request, res: Response): Promise<void> {
  const projectId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "INVALID_PROJECT_ID" }); return; }
  try {
    const proj = await _projectsDeps.db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!proj || proj.length === 0) { res.status(404).json({ error: "PROJECT_NOT_FOUND" }); return; }
    const rows = await _projectsDeps.db
      .select({
        id: projectActorsTable.id, projectId: projectActorsTable.projectId, actorId: projectActorsTable.actorId,
        roleName: projectActorsTable.roleName, roleType: projectActorsTable.roleType, createdAt: projectActorsTable.createdAt,
        actor: { id: actorsTable.id, name: actorsTable.name, type: actorsTable.type, category: actorsTable.category, age: actorsTable.age, style: actorsTable.style, imageUrl: actorsTable.imageUrl },
      })
      .from(projectActorsTable)
      .innerJoin(actorsTable, eq(projectActorsTable.actorId, actorsTable.id))
      .where(eq(projectActorsTable.projectId, projectId));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: "INTERNAL_ERROR: " + err.message }); }
}
router.get("/:id/actors", requireProductionAuth, listProjectActorsHandler);
router.post("/:id/actors", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(String(req.params.id)), 10);
  const { actorId, roleName, roleType } = req.body;
  if (isNaN(projectId) || !actorId || !roleName) {
    res.status(400).json({ error: "معطيات ناقصة: يجب تحديد الممثل واسم الشخصية الرقمية." });
    return;
  }
  try {
    const [assigned] = await db.insert(projectActorsTable).values({
      projectId,
      actorId: parseInt(String(actorId), 10),
      roleName: roleName.trim(),
      roleType: roleType || "supporting",
      createdAt: new Date()
    }).returning();
    res.status(201).json(assigned);
  } catch (err: any) {
    res.status(500).json({ error: "فشل تعيين الشخصية: " + err.message });
  }
});

// KAYAN-SECURITY-23: PATCH /api/projects/:id — update project metadata.
// Only the whitelisted fields declared in UpdateProjectBody are accepted.
// Unknown fields in the request body are silently dropped (zod strips them).
// `id`, `createdAt`, `updatedAt`, `isArchived` are NOT user-writable here.
router.patch("/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "معرف المشروع غير صالح." });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title.trim();
  if (data.worldId !== undefined) updateData.worldId = data.worldId;
  if (data.projectType !== undefined) updateData.projectType = data.projectType;
  if (data.style !== undefined) updateData.style = data.style;
  if (data.synopsis !== undefined) updateData.synopsis = data.synopsis ? data.synopsis.trim() : null;
  if (data.status !== undefined) updateData.status = data.status;
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد حقول قابلة للتحديث." });
    return;
  }
  updateData.updatedAt = new Date();
  try {
    const [updated] = await db
      .update(projectsTable)
      .set(updateData)
      .where(eq(projectsTable.id, projectId))
      .returning();
    if (!updated) { res.status(404).json({ error: "المشروع غير موجود." }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "فشل تحديث المشروع: " + err.message });
  }
});

// KAYAN-SECURITY-23: DELETE /api/projects/:id/actors/:actorId
// Removes ONLY the project↔actor link row. The actor record itself is
// preserved. The WHERE clause uses BOTH projectId and actorId so a caller
// cannot delete an association belonging to a different project.
router.delete("/:id/actors/:actorId", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id), 10);
  const actorId = parseInt(String(req.params.actorId), 10);
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(actorId) || actorId <= 0) {
    res.status(400).json({ error: "معرف المشروع أو الممثل غير صالح." });
    return;
  }
  try {
    const deleted = await db
      .delete(projectActorsTable)
      .where(and(eq(projectActorsTable.projectId, projectId), eq(projectActorsTable.actorId, actorId)))
      .returning();
    if (deleted.length === 0) {
      res.status(404).json({ error: "ارتباط الممثل بهذا المشروع غير موجود." });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: "فشل إزالة الممثل من المشروع: " + err.message });
  }
});

// KAYAN-AWS-EXIT-24: bare DELETE /:id was missing; cascade-deletes related rows via FK.
router.delete("/:id", requireProductionAuth, async (req: Request, res: Response): Promise<void> => {
  const projectId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "معرف المشروع غير صالح." });
    return;
  }
  try {
    const deleted = await db
      .delete(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .returning({ id: projectsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "المشروع غير موجود." });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: "فشل حذف المشروع: " + err.message });
  }
});

export default router;
