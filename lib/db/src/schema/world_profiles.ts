import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const worldProfilesTable = pgTable("world_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  
  // الحقول المنظمة الجديدة المضافة للإصلاح الثامن دون حذف الحقول الحالية
  location: text("location"),
  geography: text("geography"),
  architecture: text("architecture"),
  technologyLevel: text("technology_level"),
  clothingStyle: text("clothing_style"),
  weather: text("weather"),
  lighting: text("lighting"),
  colorPalette: text("color_palette"),
  atmosphere: text("atmosphere"),
  visualStyle: text("visual_style"),
  masterPrompt: text("master_prompt"),
  negativePrompt: text("negative_prompt"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

// تحديث الـ Schemas لتدعم الحقول الجديدة تلقائياً في التوثيق والفحص
export const insertWorldProfileSchema = createInsertSchema(worldProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectWorldProfileSchema = createSelectSchema(worldProfilesTable);

export type InsertWorldProfile = z.infer<typeof insertWorldProfileSchema>;
export type WorldProfile = typeof worldProfilesTable.$inferSelect;
