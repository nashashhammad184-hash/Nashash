import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { shotsTable } from "./shots";

// ==========================================
// 1. نظام السلاسل والمسلسلات (Series System)
// ==========================================
export const seriesTable = pgTable("series", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  worldId: text("world_id").notNull(),
  synopsis: text("synopsis"),
  style: text("style").notNull().default("drama"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
});

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => seriesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seasonsTable.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

// ==========================================
// 2. نظام الموارد المركزي (Assets System)
// ==========================================
export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodesTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // CHARACTER_REFERENCE, WORLD_REFERENCE, SHOT_VIDEO, VOICE, MUSIC, SFX, SUBTITLE, FINAL_RENDER
  status: text("status").notNull().default("active"),
  provider: text("provider").notNull(),
  urlPath: text("url_path").notNull(),
  metadata: jsonb("metadata").default({}),
  characterId: integer("character_id"),
  worldId: text("world_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
});

// ==========================================
// 3. نظام الوظائف والـ Retry (Production Jobs)
// ==========================================
export const jobsTable = pgTable("production_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // VIDEO_GENERATION, VOICE_GENERATION, LIP_SYNC, AUDIO_GENERATION, RENDER
  status: text("status").notNull().default("QUEUED"), // QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodesTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  inputData: jsonb("input").default({}),
  outputData: jsonb("output").default({}),
  progress: integer("progress").notNull().default(0),
  errorMessage: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at")
});
