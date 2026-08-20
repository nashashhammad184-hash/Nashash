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
  
  // الحقول الجديدة لبناء الـ Timeline الاحترافي
  sourceAssetId: integer("source_asset_id"), 
  startTime: text("start_time").default("00:00.00"),
  endTime: text("end_time"),
  timelinePosition: integer("timeline_position").default(0),
  trackNumber: integer("track").default(1), // Video or Audio track layers
  audioSettings: text("audio_settings"), // Volume, Fade settings stored as config string
  transitionType: text("transition").default("none"), // fade, dissolve, cross-zoom etc
  subtitlesText: text("subtitles"),
  appliedEffects: text("effects"),
  seasonNumber: integer("season_number").default(1),
  episodeNumber: integer("episode_number").default(1),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEditClipSchema = createInsertSchema(editClipsTable).omit({ id: true, createdAt: true });
export type InsertEditClip = z.infer<typeof insertEditClipSchema>;
export type EditClip = typeof editClipsTable.$inferSelect;
