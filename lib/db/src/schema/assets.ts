import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { scriptsTable } from "./scripts";
import { shotsTable } from "./shots";
import { actorsTable } from "./actors";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  scriptId: integer("script_id").references(() => scriptsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => actorsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // character_image, world_image, scene_reference, shot_video, voice_file, music, sfx, subtitle, final_render
  url: text("url").notNull(),
  provider: text("provider").notNull(), // openai, elevenlabs, runway, suno, udio, local
  status: text("status").notNull().default("completed"),
  sceneNumber: integer("scene_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
