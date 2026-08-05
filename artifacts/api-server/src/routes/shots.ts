import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, shotsTable } from "@workspace/db";
import {
  ListProjectShotsParams,
  ListProjectShotsResponse,
  CreateShotBody,
  CreateShotResponse,
  UpdateShotParams,
  UpdateShotBody,
  UpdateShotResponse,
  DeleteShotParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// List shots for a project
router.get("/projects/:id/shots", async (req, res): Promise<void> => {
  const params = ListProjectShotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const shots = await db
    .select()
    .from(shotsTable)
    .where(eq(shotsTable.projectId, params.data.id))
    .orderBy(asc(shotsTable.sceneNumber));
  res.json(
    ListProjectShotsResponse.parse(
      shots.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      }))
    )
  );
});

// Create shot
router.post("/shots", async (req, res): Promise<void> => {
  const parsed = CreateShotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shot] = await db.insert(shotsTable).values(parsed.data).returning();
  res.status(201).json(
    CreateShotResponse.parse({
      ...shot,
      createdAt: shot.createdAt.toISOString(),
    })
  );
});

// Update shot
router.patch("/shots/:id", async (req, res): Promise<void> => {
  const params = UpdateShotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateShotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shot] = await db
    .update(shotsTable)
    .set(parsed.data)
    .where(eq(shotsTable.id, params.data.id))
    .returning();
  if (!shot) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }
  res.json(
    UpdateShotResponse.parse({
      ...shot,
      createdAt: shot.createdAt.toISOString(),
    })
  );
});

// Delete shot
router.delete("/shots/:id", async (req, res): Promise<void> => {
  const params = DeleteShotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [shot] = await db
    .delete(shotsTable)
    .where(eq(shotsTable.id, params.data.id))
    .returning();
  if (!shot) {
    res.status(404).json({ error: "Shot not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
