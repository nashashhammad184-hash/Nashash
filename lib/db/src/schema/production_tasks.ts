import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const productionTasksTable = pgTable("production_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id"),
  taskType: text("task_type").notNull().default("video_generation"),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"),
  providerName: text("provider_name"),
  externalJobId: text("external_job_id"),
  resultUrl: text("result_url"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  assignedActorId: integer("assigned_actor_id"),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductionTaskSchema = createInsertSchema(productionTasksTable).omit({ id: true, createdAt: true });
export type InsertProductionTask = z.infer<typeof insertProductionTaskSchema>;
export type ProductionTask = typeof productionTasksTable.$inferSelect;
