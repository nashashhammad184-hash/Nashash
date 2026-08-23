import { Router, type IRouter } from "express";
import { db, shotsTable, shotCharactersTable, actorsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

// 1. جلب لقطة معينة مع الشخصيات المرتبطة بها
router.get("/shots/:id", async (req, res): Promise<void> => {
  const shotId = parseInt(req.params.id, 10);
  if (isNaN(shotId)) {
    res.status(400).json({ error: "Invalid shotId" });
    return;
  }

  const [shot] = await db.select().from(shotsTable).where(eq(shotsTable.id, shotId));
  if (!shot) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }

  // جلب الشخصيات المشتركة في هذه اللقطة عبر جدول الربط الوسيط
  const characters = await db
    .select({
      id: shotCharactersTable.id,
      actorId: shotCharactersTable.actorId,
      role: shotCharactersTable.role,
      name: actorsTable.name,
      type: actorsTable.type,
    })
    .from(shotCharactersTable)
    .innerJoin(actorsTable, eq(shotCharactersTable.actorId, actorsTable.id))
    .where(eq(shotCharactersTable.shotId, shotId));

  res.json({ ...shot, characters });
});

// 2. [POST] إضافة شخصية (Actor) إلى لقطة معينة (Shot) — إصلاح 12
router.post("/shots/:id/characters", async (req, res): Promise<void> => {
  const shotId = parseInt(req.params.id, 10);
  const { actorId, role } = req.body;

  if (isNaN(shotId) || !actorId) {
    res.status(400).json({ error: "shotId and actorId are required" });
    return;
  }

  try {
    // إدخال العلاقة بسلام؛ وقيد الفرادة (Unique) سيمنع التكرار تلقائياً
    const [newRelation] = await db
      .insert(shotCharactersTable)
      .values({
        shotId,
        actorId: parseInt(actorId, 10),
        role: role || "appearing",
      })
      .returning();

    res.status(201).json(newRelation);
  } catch (error: any) {
    // معالجة قيد الفرادة الفريد في حال حاول المستخدم إضافة الممثل مرتين لنفس اللقطة
    if (error.code === "23505") {
      res.status(409).json({ error: "This character is already added to this shot" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. [DELETE] حذف وإلغاء ارتباط شخصية من لقطة معينة — إصلاح 12
router.delete("/shots/:id/characters/:actorId", async (req, res): Promise<void> => {
  const shotId = parseInt(req.params.id, 10);
  const actorId = parseInt(req.params.actorId, 10);

  if (isNaN(shotId) || !isNaN(actorId) === false) {
    res.status(400).json({ error: "Invalid shotId or actorId" });
    return;
  }

  const [deleted] = await db
    .delete(shotCharactersTable)
    .where(
      and(
        eq(shotCharactersTable.shotId, shotId),
        eq(shotCharactersTable.actorId, actorId)
      )
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Character relation not found in this shot" });
    return;
  }

  res.sendStatus(204);
});

export default router;
