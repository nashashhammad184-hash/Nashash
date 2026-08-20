import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const seriesSeasonsTable = pgTable("series_seasons", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const seriesEpisodesTable = pgTable("series_episodes", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seriesSeasonsTable.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSeasonSchema = createInsertSchema(seriesSeasonsTable).omit({ id: true, createdAt: true });
export const insertEpisodeSchema = createInsertSchema(seriesEpisodesTable).omit({ id: true, createdAt: true });
