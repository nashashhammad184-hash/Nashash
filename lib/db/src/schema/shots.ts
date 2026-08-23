import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";

// ── 1. جدول المشاهد المستقل الجديد PRODUCTION SCENES (إصلاح 23) ──
export const scenesTable = pgTable("scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  episodeId: integer("episode_id"), // nullable تلقائياً للمسلسلات والأفلام
  sceneNumber: text("scene_number").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  timeOfDay: text("time_of_day"), // e.g., 'Day', 'Night', 'Golden Hour'
  weather: text("weather"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSceneSchema = createInsertSchema(scenesTable).omit({ id: true, createdAt: true });
export type InsertScene = z.infer<typeof insertSceneSchema>;
export type Scene = typeof scenesTable.$inferSelect;


// ── 2. جدول اللقطات المطور SHOTS (تحديث إصلاح 23) ──
// محمي ومحافظ على الـ 65 سجل القديم بالكامل مع حيازة عمود sceneNumber للتوافق
export const shotsTable = pgTable("shots", {
  id: serial("id").primaryKey(),
  scriptId: integer("script_id"),
  shotNumber: text("shot_number"),
  description: text("description"),
  visualCue: text("visual_cue"),
  audioCue: text("audio_cue"),
  durationSeconds: integer("duration_seconds"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),

  // ربط اللقطة بالمشهد المستقل الجديد (Shot.sceneId -> scenes.id)
  sceneId: integer("scene_id")
    .references(() => scenesTable.id, { onDelete: "set null" }),

  // ── PRESERVED SHOT COLUMNS (للتوافق القديم وحماية الـ 65 سجل من الحذف) ──
  sceneNumber: text("scene_number"), // المحافظة الصارمة عليه
  projectId: integer("project_id"),
  shotOrder: integer("shot_order"),
  cameraMovement: text("camera_movement"),
  dialogue: text("dialogue"),
  audioNote: text("audio_note"),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
});

export const insertShotSchema = createInsertSchema(shotsTable).omit({ id: true, createdAt: true });
export type InsertShot = z.infer<typeof insertShotSchema>;
export type Shot = typeof shotsTable.$inferSelect;


// ── 3. جدول العلاقات الوسيط لـ SHOT CHARACTERS ──
export const shotCharactersTable = pgTable("shot_characters", {
  id: serial("id").primaryKey(),
  shotId: integer("shot_id")
    .notNull()
    .references(() => shotsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id")
    .notNull()
    .references(() => actorsTable.id, { onDelete: "cascade" }),
  role: text("role").default("appearing"), 
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("shot_actor_unique_idx").on(t.shotId, t.actorId),
]);

export const insertShotCharacterSchema = createInsertSchema(shotCharactersTable).omit({ id: true, createdAt: true });
export type InsertShotCharacter = z.infer<typeof insertShotCharacterSchema>;
export type ShotCharacter = typeof shotCharactersTable.$inferSelect;


// ── 4. جدول الوظائف المنفصل VIDEO GENERATION JOBS ──
export const videoGenerationJobsTable = pgTable("video_generation_jobs", {
  id: serial("id").primaryKey(),
  shotId: integer("shot_id")
    .notNull()
    .references(() => shotsTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("queued"), 
  videoUrl: text("video_url"),
  errorLog: text("error_log"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoJobSchema = createInsertSchema(videoGenerationJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type VideoGenerationJob = typeof videoGenerationJobsTable.$inferSelect;
