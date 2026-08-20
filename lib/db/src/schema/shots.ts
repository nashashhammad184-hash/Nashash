import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { scriptsTable } from "./scripts";

export const shotsTable = pgTable("shots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  scriptId: integer("script_id").references(() => scriptsTable.id, { onDelete: "cascade" }),
  sceneNumber: integer("scene_number").notNull(),
  seasonNumber: integer("season_number").default(1),
  episodeNumber: integer("episode_number").default(1),
  shotOrder: integer("shot_order"),
  description: text("description").notNull(),
  cameraMovement: text("camera_movement").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(5),
  dialogue: text("dialogue"),
  audioNote: text("audio_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShotSchema = createInsertSchema(shotsTable).omit({ id: true, createdAt: true });
export type InsertShot = z.infer<typeof insertShotSchema>;
export type Shot = typeof shotsTable.$inferSelect;
