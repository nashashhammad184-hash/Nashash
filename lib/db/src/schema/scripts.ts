import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const scriptsTable = pgTable("scripts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  idea: text("idea").notNull(),
  worldId: text("world_id").notNull(),
  generatedContent: text("generated_content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScriptSchema = createInsertSchema(scriptsTable).omit({ id: true, createdAt: true });
export type InsertScript = z.infer<typeof insertScriptSchema>;
export type Script = typeof scriptsTable.$inferSelect;
