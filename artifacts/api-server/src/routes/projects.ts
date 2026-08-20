import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  projectsTable,
  projectActorsTable,
  actorsTable,
} from "@workspace/db";
import {
  ListProjectsResponse,
  CreateProjectBody,
  GetProjectParams,
  GetProjectResponse,
  UpdateProjectParams,
  UpdateProjectBody,
  UpdateProjectResponse,
  DeleteProjectParams,
  ArchiveProjectParams,
  ArchiveProjectBody,
  ArchiveProjectResponse,
  ListProjectActorsParams,
  ListProjectActorsResponse,
  AssignActorToProjectParams,
  AssignActorToProjectBody,
  AssignActorToProjectResponse,
  RemoveActorFromProjectParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// List projects
router.get("/projects", async (req, res): Promise<void> => {
  const archivedParam = req.query["archived"];
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.createdAt));

  let filtered = projects;
  if (archivedParam === "true") {
    filtered = projects.filter((p) => p.isArchived);
  } else if (archivedParam === "false") {
    filtered = projects.filter((p) => !p.isArchived);
  }

  res.json(
    ListProjectsResponse.parse(
      filtered.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt?.toISOString() ?? null,
      }))
    )
  );
});

// Create project
router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, status: "development" })
    .returning();
  res.status(201).json(
    GetProjectResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    })
  );
});

// Get project
router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(
    GetProjectResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    })
  );
});

// Update project
router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db
    .update(projectsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(projectsTable.id, params.data.id))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(
    UpdateProjectResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    })
  );
});

// Delete project
router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.sendStatus(204);
});

// Archive / unarchive project
router.patch("/projects/:id/archive", async (req, res): Promise<void> => {
  const params = ArchiveProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ArchiveProjectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [project] = await db
    .update(projectsTable)
    .set({ isArchived: body.data.isArchived, updatedAt: new Date() })
    .where(eq(projectsTable.id, params.data.id))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(
    ArchiveProjectResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    })
  );
});

// List actors assigned to project with rich Bible fields
router.get("/projects/:id/actors", async (req, res): Promise<void> => {
  const params = ListProjectActorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({
      id: projectActorsTable.id,
      projectId: projectActorsTable.projectId,
      actorId: projectActorsTable.actorId,
      roleName: projectActorsTable.roleName,
      roleType: projectActorsTable.roleType,
      createdAt: projectActorsTable.createdAt,
      actor: {
        id: actorsTable.id,
        name: actorsTable.name,
        type: actorsTable.type,
        age: actorsTable.age,
        style: actorsTable.style,
        imageUrl: actorsTable.imageUrl,
        gender: actorsTable.gender,
        eyeColor: actorsTable.eyeColor,
        hairStyle: actorsTable.hairStyle,
        physicalDescription: actorsTable.physicalDescription,
        personalityTraits: actorsTable.personalityTraits,
        backstory: actorsTable.backstory,
        clothingPrompt: actorsTable.clothingPrompt,
        characterMasterPrompt: actorsTable.characterMasterPrompt,
        characterNegativePrompt: actorsTable.characterNegativePrompt,
        voiceId: actorsTable.voiceId
      },
    })
    .from(projectActorsTable)
    .innerJoin(actorsTable, eq(projectActorsTable.actorId, actorsTable.id))
    .where(eq(projectActorsTable.projectId, params.data.id))
    .orderBy(projectActorsTable.createdAt);

  res.json(
    ListProjectActorsResponse.parse(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))
    )
  );
});

// Assign actor to project
router.post("/projects/:id/actors", async (req, res): Promise<void> => {
  const params = AssignActorToProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = AssignActorToProjectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [assignment] = await db
    .insert(projectActorsTable)
    .values({ projectId: params.data.id, ...body.data })
    .returning();
  const [actor] = await db
    .select()
    .from(actorsTable)
    .where(eq(actorsTable.id, assignment.actorId));

  res.status(201).json(
    AssignActorToProjectResponse.parse({
      ...assignment,
      createdAt: assignment.createdAt.toISOString(),
      actor,
    })
  );
});

// Remove actor from project fixing multi-delete bug
router.delete("/projects/:id/actors/:actorId", async (req, res): Promise<void> => {
  const params = RemoveActorFromProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(projectActorsTable)
    .where(
      and(
        eq(projectActorsTable.projectId, params.data.id),
        eq(projectActorsTable.actorId, params.data.actorId)
      )
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
