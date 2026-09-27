import { pgTable, serial, integer, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { shotsTable } from "./shots";
import { editClipsTable } from "./edit_clips";

export const timelineItemsTable = pgTable("timeline_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "set null" }),
  clipId: integer("clip_id").references(() => editClipsTable.id, { onDelete: "set null" }),
  assetId: text("asset_id"),
  assetUrl: text("asset_url"),
  track: text("track").notNull(), // 'VIDEO' | 'VOICE' | 'MUSIC' | 'SFX' | 'SUBTITLE'
  startTime: doublePrecision("start_time").notNull().default(0),
  duration: doublePrecision("duration").notNull().default(0),
  endTime: doublePrecision("end_time").notNull().default(0),
  order: integer("order_index").notNull().default(0),
  content: text("content"), // Dialogue, subtitle text, audio note, or prompt
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTimelineItemSchema = createInsertSchema(timelineItemsTable).omit({ id: true, createdAt: true });
export type InsertTimelineItem = z.infer<typeof insertTimelineItemSchema>;
export type TimelineItem = typeof timelineItemsTable.$inferSelect;
