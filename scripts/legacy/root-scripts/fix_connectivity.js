const fs = require('fs');
const path = require('path');

console.log("🚀 البدء في معالجة وإصلاح طبقة الاتصال والـ API Routes سينمائياً...");

// 1. تحديث وإصلاح ملف الـ Express Router للمشاريع ليغطي العمليات الخمس القياسية وبشكل مطابق للـ Client
const projectsRoutePath = path.resolve('/home/ubuntu/Nashash/artifacts/api-server/src/routes/projects.ts');

const coreProjectsCode = `import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { projectsTable, shotsTable, editClipsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/projects - جلب كل المشاريع الحية
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const allProjects = await db.select().from(projectsTable);
    // إرجاع مصفوفة مباشرة لتتوافق مع توقعات الـ React Query / Client
    res.json(allProjects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id - جلب تفاصيل مشروع معين
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(req.params.id, 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid project ID format." });
    return;
  }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, numericId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects - إنشاء مشروع جديد من الواجهة
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, synopsis, worldId, projectType, style } = req.body;
    if (!title) {
      res.status(400).json({ error: "Project title is required." });
      return;
    }
    const [newProject] = await db.insert(projectsTable).values({
      title: title.trim(),
      synopsis: synopsis ? synopsis.trim() : null,
      worldId: worldId || "drama",
      projectType: projectType || "film",
      style: style || "drama",
      status: "pre_production",
      isArchived: false,
      updatedAt: new Date()
    }).returning();
    
    res.status(201).json(newProject);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id - تحديث بيانات المشروع (Overview Tab)
router.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(req.params.id, 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid project ID format." });
    return;
  }
  try {
    const { title, synopsis, status, isArchived } = req.body;
    const updateData: Record<string, any> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (synopsis !== undefined) updateData.synopsis = synopsis.trim();
    if (status !== undefined) updateData.status = status;
    if (isArchived !== undefined) updateData.isArchived = !!isArchived;
    updateData.updatedAt = new Date();

    const [updatedProject] = await db.update(projectsTable)
      .set(updateData)
      .where(eq(projectsTable.id, numericId))
      .returning();

    if (!updatedProject) {
      res.status(404).json({ error: "Project not found to update." });
      return;
    }
    res.json(updatedProject);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id - حذف مشروع
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const numericId = parseInt(req.params.id, 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid project ID format." });
    return;
  }
  try {
    const [deleted] = await db.delete(projectsTable).where(eq(projectsTable.id, numericId)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Project not found to delete." });
      return;
    }
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/auto-edit
router.post("/:id/auto-edit", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const numericId = parseInt(String(id), 10);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid project ID format. Expected numeric ID." });
    return;
  }
  try {
    const project = await db.select().from(projectsTable).where(eq(projectsTable.id, numericId));
    if (!project || project.length === 0) {
      res.status(404).json({ error: "Project not found in DB" });
      return;
    }
    const projectShots = await db.select().from(shotsTable).where(eq(shotsTable.projectId, numericId));
    if (!projectShots || projectShots.length === 0) {
      res.status(400).json({ error: "No real shots found for this project" });
      return;
    }
    const clipsToInsert = projectShots.map((shot, index) => ({
      projectId: numericId,
      shotId: shot.id,
      title: \`Clip for Shot \${shot.id}\`,
      durationSeconds: shot.durationSeconds || 5,
      clipOrder: index + 1,
      trackType: "video",
      startTime: 0,
      endTime: Number(shot.durationSeconds || 5),
      sourceStart: 0,
      sourceEnd: Number(shot.durationSeconds || 5),
      volume: 1.0
    }));
    const insertedClips = await db.insert(editClipsTable).values(clipsToInsert).returning();
    res.json({
      success: true,
      projectId: numericId,
      autoEdit: {
        status: "completed",
        decisions: insertedClips
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
`;

fs.writeFileSync(projectsRoutePath, coreProjectsCode, 'utf8');
console.log("✅ تم حقن وتحديث ملف الـ Router القياسي للمشاريع بنجاح.");

// 2. التحقق من مسار الـ Healthz وضمان عمله
const healthRoutePath = path.resolve('/home/ubuntu/Nashash/artifacts/api-server/src/routes/health.ts');
if (fs.existsSync(healthRoutePath)) {
  const healthCode = `import { Router, type IRouter } from "express";
const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
`;
  fs.writeFileSync(healthRoutePath, healthCode, 'utf8');
  console.log("✅ تم توحيد مسار الفحص الميداني الـ /healthz بنجاح.");
}

console.log("🎉 اكتملت المعالجة الهيكلية للـ Network Layer بنجاح 100%!");
