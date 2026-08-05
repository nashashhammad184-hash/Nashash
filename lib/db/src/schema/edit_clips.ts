import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const editClipsTable = pgTable("edit_clips", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds"),
  notes: text("notes"),
  clipOrder: integer("clip_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEditClipSchema = createInsertSchema(editClipsTable).omit({ id: true, createdAt: true });
export type InsertEditClip = z.infer<typeof insertEditClipSchema>;
export type EditClip = typeof editClipsTable.$inferSelect;
