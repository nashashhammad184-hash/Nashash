import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const scriptsTable = pgTable("scripts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  idea: text("idea").notNull(),
  worldId: text("world_id").notNull(),
  seasonNumber: integer("season_number").default(1),
  episodeNumber: integer("episode_number").default(1),
  generatedContent: text("generated_content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScriptSchema = createInsertSchema(scriptsTable).omit({ id: true, createdAt: true });
export type InsertScript = z.infer<typeof insertScriptSchema>;
export type Script = typeof scriptsTable.$inferSelect;

// --- نظام الأصول المركزي المطور الموفر للموارد (Assets System) ---
export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  targetId: text("target_id").notNull(), // يربط بمعرف اللقطة، الممثل، أو المشهد ديناميكياً
  assetType: text("asset_type").notNull(), // character_image, world_image, shot_video, voice, music, sfx, subtitle, final_render
  assetUrl: text("asset_url").notNull(), // رابط الملف المادي الحقيقي على السيرفر أو التخزين الخارجي
  metaData: text("meta_data"), // حقل نصي مرن لتخزين أي تفاصيل إضافية بدون استهلاك موارد
});
