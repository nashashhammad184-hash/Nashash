import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { z } from "zod";

export const worldProfilesTable = pgTable("world_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(), 
  era: text("era"), 
  visualStyle: text("visual_style").notNull(), 
  lightingType: text("lighting_type"), 
  colorGrading: text("color_grading"), 
  architectureStyle: text("architecture_style"), 
  atmosphere: text("atmosphere"), 
  masterStylePrompt: text("master_style_prompt"), 
  negativeStylePrompt: text("negative_style_prompt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWorldProfileSchema = z.object({
  projectId: z.number(),
  name: z.string(),
  era: z.string().nullable().optional(),
  visualStyle: z.string(),
  lightingType: z.string().nullable().optional(),
  colorGrading: z.string().nullable().optional(),
  architectureStyle: z.string().nullable().optional(),
  atmosphere: z.string().nullable().optional(),
  masterStylePrompt: z.string().nullable().optional(),
  negativeStylePrompt: z.string().nullable().optional(),
});

export const selectWorldProfileSchema = insertWorldProfileSchema.extend({
  id: z.number(),
  createdAt: z.date(),
});

export type InsertWorldProfile = z.infer<typeof insertWorldProfileSchema>;
export type WorldProfile = typeof worldProfilesTable.$inferSelect;
