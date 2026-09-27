import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const rendersTable = pgTable("renders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("QUEUED"),
  outputUrl: text("output_url"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertRenderSchema = createInsertSchema(rendersTable).omit({ id: true, createdAt: true, completedAt: true });
export type InsertRender = z.infer<typeof insertRenderSchema>;
export type RenderJob = typeof rendersTable.$inferSelect;
