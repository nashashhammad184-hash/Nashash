import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { z } from "zod";

export const worldProfilesTable = pgTable("world_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  worldId: text("world_id").notNull(), // noir, scifi, history, fantasy, drama
  
  // Extended World Bible Features
  era: text("era"),
  location: text("location"),
  geography: text("geography"),
  architecture: text("architecture"),
  clothingStyle: text("clothing_style"),
  technology: text("technology"),
  lighting: text("lighting"),
  colorPalette: text("color_palette"),
  atmosphere: text("atmosphere"),
  weather: text("weather"),
  visualStyle: text("visual_style"),
  
  masterPrompt: text("master_prompt"),
  negativePrompt: text("negative_prompt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WorldProfile = typeof worldProfilesTable.$inferSelect;
