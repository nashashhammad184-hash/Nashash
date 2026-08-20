import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// 1. جدول المسلسلات (Series)
export const seriesTable = pgTable("series", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 2. جدول المواسم (Seasons)
export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").references(() => seriesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 3. جدول الحلقات (Episodes)
export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").references(() => seasonsTable.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 4. جدول المشاهد الحقيقي (Scenes)
export const realScenesTable = pgTable("real_scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }), // للأفلام المستقلة
  episodeId: integer("episode_id").references(() => episodesTable.id, { onDelete: "cascade" }), // للمسلسلات
  sceneNumber: integer("scene_number").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  timeOfDay: text("time_of_day"), // Day, Night, Golden Hour
  weather: text("weather"),
  characters: jsonb("characters").$type<number[]>().default([]), // مصفوفة معرفات الممثلين
  worldId: text("world_id"),
  description: text("description"),
  continuityContext: text("continuity_context"),
  status: text("status").notNull().default("draft"), // draft, ready, filming, completed
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 5. جدول اللقطات الحقيقي (Shots)
export const realShotsTable = pgTable("real_shots", {
  id: serial("id").primaryKey(),
  sceneId: integer("scene_id").references(() => realScenesTable.id, { onDelete: "cascade" }),
  shotOrder: integer("shot_order").notNull(),
  camera: text("camera"), // Closeup, Wide, Crane, Pan
  lighting: text("lighting"),
  duration: integer("duration").default(5),
  action: text("action"),
  dialogue: text("dialogue"),
  audio: text("audio"),
  music: text("music"),
  subtitle: text("subtitle"),
  productionPrompt: text("production_prompt"),
  status: text("status").notNull().default("pending"), // pending, generating, ready, failed
  generatedVideoAsset: text("generated_video_asset"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
