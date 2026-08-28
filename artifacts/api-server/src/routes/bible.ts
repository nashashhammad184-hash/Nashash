import { Router, type IRouter } from "express";
import { db, actorsTable, worldProfilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

// 1. Update/Save Character Bible
router.patch("/actors/:id/bible", async (req, res): Promise<void> => {
  const actorId = parseInt(req.params.id, 10);
  if (isNaN(actorId)) {
    res.status(400).json({ error: "Invalid Actor ID" });
    return;
  }

  try {
    const [updated] = await db
      .update(actorsTable)
      .set({
        role: req.body.role,
        gender: req.body.gender,
        personality: req.body.personality,
        background: req.body.background,
        behavior: req.body.behavior,
        speakingStyle: req.body.speakingStyle,
        appearance: req.body.appearance || {},
        wardrobe: req.body.wardrobe || {},
        characterPrompt: req.body.characterPrompt,
        negativePrompt: req.body.negativePrompt,
        referenceImages: req.body.referenceImages || [],
        voiceId: req.body.voiceId,
        voiceSettings: req.body.voiceSettings || { stability: 0.75, clarity: 0.75 }
      })
      .where(eq(actorsTable.id, actorId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Actor not found" });
      return;
    }
    res.json({ success: true, actor: updated });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: String(error) });
  }
});

// 2. Save/Update World Bible
router.post("/projects/:id/world-bible", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id, 10);
  const { worldId } = req.body;

  if (isNaN(projectId) || !worldId) {
    res.status(400).json({ error: "Project ID and World ID are required" });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(worldProfilesTable)
      .where(and(eq(worldProfilesTable.projectId, projectId), eq(worldProfilesTable.id, worldId)))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(worldProfilesTable)
        .set({ ...req.body })
        .where(eq(worldProfilesTable.id, existing[0].id))
        .returning();
      res.json({ success: true, worldBible: updated });
    } else {
      const [created] = await db
        .insert(worldProfilesTable)
        .values({ projectId, ...req.body })
        .returning();
      res.status(201).json({ success: true, worldBible: created });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to save World Bible", message: String(error) });
  }
});

export default router;
