import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { realScenesTable, realShotsTable } from "./production_hierarchy";
import { actorsTable } from "./actors";

// 1. نظام إدارة الأصول المركزي (Assets System)
export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // CHARACTER_REFERENCE, WORLD_REFERENCE, SHOT_VIDEO, VOICE, MUSIC, SFX, SUBTITLE, FINAL_RENDER
  fileUrl: text("file_url").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<any>().default({}),
  sceneId: integer("scene_id").references(() => realScenesTable.id, { onDelete: "set null" }),
  shotId: integer("shot_id").references(() => realShotsTable.id, { onDelete: "set null" }),
  characterId: integer("character_id").references(() => actorsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 2. نظام إدارة المهام الخلفية الحقيقي (Generation Jobs System)
export const generationJobsTable = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  shotId: integer("shot_id").references(() => realShotsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // VIDEO_GEN, VOICE_GEN, LIP_SYNC, MUSIC_SFX_GEN
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  inputData: jsonb("input_data").notNull().default({}),
  outputData: jsonb("output_data").default({}),
  progress: integer("progress").notNull().default(0),
  status: text("status").notNull().default("QUEUED"), // QUEUED, PROCESSING, COMPLETED, FAILED, RETRY
  errorLog: text("error_log"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
