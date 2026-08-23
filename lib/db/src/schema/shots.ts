import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";

// 1. جدول اللقطات الأساسي
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

  projectId: integer("project_id"),
  sceneNumber: text("scene_number"),
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

// 2. جدول العلاقات الوسيط لـ SHOT CHARACTERS
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

// 3. جدول الوظائف المنفصل VIDEO GENERATION JOBS
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
