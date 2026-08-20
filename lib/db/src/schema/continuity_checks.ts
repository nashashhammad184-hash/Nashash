import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { shotsTable } from "./shots";

export const continuityChecksTable = pgTable("continuity_checks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "cascade" }),
  
  // حقول فحص الاستمرارية السبعة المطلوبة
  characterMatch: boolean("character_match").default(true),
  clothingMatch: boolean("clothing_match").default(true),
  locationMatch: boolean("location_match").default(true),
  lightingMatch: boolean("lighting_match").default(true),
  dialogueMatch: boolean("dialogue_match").default(true),
  timelineLogic: boolean("timeline_logic").default(true),
  sceneTransitionValid: boolean("scene_transition_valid").default(true),
  
  // القرار الإنتاجي النهائي
  decision: text("decision").notNull().default("PASS"), // PASS أو REGENERATE
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContinuityCheckSchema = createInsertSchema(continuityChecksTable).omit({ id: true, createdAt: true });
export type InsertContinuityCheck = z.infer<typeof insertContinuityCheckSchema>;
export type ContinuityCheck = typeof continuityChecksTable.$inferSelect;
