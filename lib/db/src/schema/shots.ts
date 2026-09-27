import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const shotsTable = pgTable("shots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  scriptId: integer("script_id"),
  
  // ضبط حقول الأرقام لتقرأ كـ text متطابقة مع داتابيز السيرفر الحالية ومنع تعارض الأنواع
  sceneNumber: text("scene_number").notNull().default("1"), 
  shotOrder: integer("shot_order"),
  
  description: text("description").notNull(),
  cameraMovement: text("camera_movement").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(5),
  dialogue: text("dialogue"),
  audioNote: text("audio_note"),
  
  // حقول معالجة وحفظ أصول الصوت الحقيقية لـ Deepgram
  audioUrl: text("audio_url"),
  videoUrl: text("video_url"),
  audioStatus: text("audio_status").notNull().default("QUEUED"), // QUEUED, PROCESSING, COMPLETED, FAILED

  // الحفاظ الكامل على الأعمدة الـ 17 الحالية بنصوصها الأصلية لمنع فقدان البيانات والـ Data Loss
  season_number: text("season_number"),
  episode_number: text("episode_number"),
  shot_number: text("shot_number"),
  visual_cue: text("visual_cue"),
  audio_cue: text("audio_cue"),
  status: text("status"),
  scene_id_old: text("scene_id_old"),
  voice_id: text("voice_id"),
  provider: text("provider"),
  provider_job_id: text("provider_job_id"),
  duration: text("duration"),
  error: text("error"),
  lipsync_status: text("lipsync_status"),
  lipsync_provider_job_id: text("lipsync_provider_job_id"),
  lipsync_video_url: text("lipsync_video_url"),
  lipsync_error: text("lipsync_error"),
  scene_id: text("scene_id"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShotSchema = createInsertSchema(shotsTable).omit({ id: true, createdAt: true });
export type InsertShot = z.infer<typeof insertShotSchema>;
export type Shot = typeof shotsTable.$inferSelect;
