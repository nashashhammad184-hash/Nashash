import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetsTable } from "./production_pipeline";

// 5. جدول مقاطع المونتاج المطور EDIT CLIPS (إصلاح 20) متوافق 100% مع الأنواع الصارمة والجديدة
export const editClipsTable = pgTable("edit_clips", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  notes: text("notes"),
  clipOrder: integer("clip_order").notNull(),
  videoUrl: text("video_url"), 

  createdAt: timestamp("created_at").defaultNow(),
  sourceAssetId: text("source_asset_id"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  timelinePosition: text("timeline_position"),
  track: text("track"),
  audioSettings: text("audio_settings"), 
  subtitles: text("subtitles"),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  effects: text("effects"), 

  // الحقول الـ 9 الهيكلية المطلوبة لغرفة المونتاج الاحترافية
  assetId: integer("asset_id")
    .references(() => assetsTable.id, { onDelete: "set null" }), 
  trackType: text("track_type"), 
  timelineStart: integer("timeline_start"), 
  timelineEnd: integer("timeline_end"),     
  sourceStart: integer("source_start"),     
  sourceEnd: integer("source_end"),         
  volume: integer("volume"),                 
  transition: text("transition"),           
  effectsNew: jsonb("effects_new").default({}),    
});

export const insertEditClipSchema = createInsertSchema(editClipsTable).omit({ id: true });
export type InsertEditClip = z.infer<typeof insertEditClipSchema>;
export type EditClip = typeof editClipsTable.$inferSelect;
