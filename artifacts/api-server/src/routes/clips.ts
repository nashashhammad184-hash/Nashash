import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, editClipsTable } from "@workspace/db";
import {
  ListProjectClipsParams,
  ListProjectClipsResponse,
  CreateClipBody,
  CreateClipResponse,
  UpdateClipParams,
  UpdateClipBody,
  UpdateClipResponse,
  DeleteClipParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// List clips for a project
router.get("/projects/:id/clips", async (req, res): Promise<void> => {
  const params = ListProjectClipsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const clips = await db
    .select()
    .from(editClipsTable)
    .where(eq(editClipsTable.projectId, params.data.id))
    .orderBy(asc(editClipsTable.clipOrder));
  res.json(
    ListProjectClipsResponse.parse(
      clips.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      }))
    )
  );
});

// Create clip
router.post("/clips", async (req, res): Promise<void> => {
  const parsed = CreateClipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [clip] = await db
    .insert(editClipsTable)
    .values({
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      durationSeconds: parsed.data.durationSeconds ?? null,
      notes: parsed.data.notes ?? null,
      clipOrder: parsed.data.clipOrder ?? 0,
    } as any)
    .returning();

  res.status(201).json(
    CreateClipResponse.parse({
      ...clip,
      createdAt: clip.createdAt.toISOString(),
    })
  );
});

// Update clip
router.patch("/clips/:id", async (req, res): Promise<void> => {
  const params = UpdateClipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [clip] = await db
    .update(editClipsTable)
    .set(parsed.data as any)
    .where(eq(editClipsTable.id, params.data.id))
    .returning();
  if (!clip) {
    res.status(404).json({ error: "Clip not found" });
    return;
  }
  res.json(
    UpdateClipResponse.parse({
      ...clip,
      createdAt: clip.createdAt.toISOString(),
    })
  );
});

// Delete clip
router.delete("/clips/:id", async (req, res): Promise<void> => {
  const params = DeleteClipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [clip] = await db
    .delete(editClipsTable)
    .where(eq(editClipsTable.id, params.data.id))
    .returning();
  if (!clip) {
    res.status(404).json({ error: "Clip not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
