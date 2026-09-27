import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectActorsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const allProjects = await db.select().from(projectsTable);
    res.json(allProjects);
  } catch (err: any) {
    res.status(500).json({ error: "فشل في جلب المشاريع: " + err.message });
  }
});

router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(String(String(req.params.id)), 10);
  if (isNaN(numericId)) { res.status(400).json({ error: "معرف غير صالح." }); return; }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, numericId));
    if (!project) { res.status(404).json({ error: "المشروع غير موجود." }); return; }
    res.json(project);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
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

router.post("/:id/actors", async (req: Request, res: Response): Promise<void> => {
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

export default router;
