import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, productionTasksTable } from "@workspace/db";
import {
  ListProjectTasksParams,
  ListProjectTasksResponse,
  CreateTaskBody,
  CreateTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// List tasks for a project
router.get("/projects/:id/tasks", async (req, res): Promise<void> => {
  const params = ListProjectTasksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tasks = await db
    .select()
    .from(productionTasksTable)
    .where(eq(productionTasksTable.projectId, params.data.id))
    .orderBy(asc(productionTasksTable.createdAt));
  res.json(
    ListProjectTasksResponse.parse(
      tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      }))
    )
  );
});

// Create task
router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db
    .insert(productionTasksTable)
    .values({ status: "pending", ...parsed.data })
    .returning();
  res.status(201).json(
    CreateTaskResponse.parse({
      ...task,
      createdAt: task.createdAt.toISOString(),
    })
  );
});

// Update task
router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db
    .update(productionTasksTable)
    .set(parsed.data)
    .where(eq(productionTasksTable.id, params.data.id))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(
    UpdateTaskResponse.parse({
      ...task,
      createdAt: task.createdAt.toISOString(),
    })
  );
});

// Delete task
router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [task] = await db
    .delete(productionTasksTable)
    .where(eq(productionTasksTable.id, params.data.id))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
