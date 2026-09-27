import { pgTable, serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { shotsTable } from "./shots";

export const editClipsTable = pgTable("edit_clips", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds"),
  notes: text("notes"),
  clipOrder: integer("clip_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  assetId: text("asset_id"),
  trackType: text("track_type").notNull().default("video"),
  startTime: real("start_time").notNull().default(0),
  endTime: real("end_time").notNull().default(0),
  sourceStart: real("source_start").notNull().default(0),
  sourceEnd: real("source_end").notNull().default(0),
  volume: real("volume").notNull().default(1.0),
});

export const insertEditClipSchema = createInsertSchema(editClipsTable).omit({ id: true, createdAt: true });
export type InsertEditClip = z.infer<typeof insertEditClipSchema>;
export type EditClip = typeof editClipsTable.$inferSelect;
