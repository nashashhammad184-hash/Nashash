import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. جدول الأصول الأساسي المنفصل لـ Assets ──
export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // video, audio, image
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── 2. جدول وظائف العمليات الآلية المستقل PRODUCTION PIPELINE JOBS ──
export const productionPipelineJobsTable = pgTable("production_pipeline_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  jobType: text("job_type").notNull(), 
  status: text("status").notNull().default("queued"), 
  payload: jsonb("payload").default({}), 
  resultUrl: text("result_url"), 
  errorLog: text("error_log"), 
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPipelineJobSchema = createInsertSchema(productionPipelineJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPipelineJob = z.infer<typeof insertPipelineJobSchema>;
export type ProductionPipelineJob = typeof productionPipelineJobsTable.$inferSelect;


// ── 3. جدول الأصول الصوتية الحقيقية AUDIO ASSETS (إصلاح 25) ──
// تصنيف الأصول الصوتية الفعلية للأنواع الثلاثة: MUSIC, SFX, VOICE
export const audioAssetsTable = pgTable("audio_assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  shotId: integer("shot_id"), // nullable إن كان الصوت للمشروع ككل كالموسيقى الخلفية
  audioUrl: text("audio_url").notNull(), // رابط الملف الصوتي الحقيقي المخزن
  audioType: text("audio_type").notNull(), // الأنواع المستهدفة: MUSIC, SFX, VOICE
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAudioAssetSchema = createInsertSchema(audioAssetsTable).omit({ id: true, createdAt: true });
export type InsertAudioAsset = z.infer<typeof insertAudioAssetSchema>;
export type AudioAsset = typeof audioAssetsTable.$inferSelect;


// ── 4. جدول وظائف توليد الصوت المستقل AUDIO GENERATION JOBS (إصلاح 25) ──
export const audioGenerationJobsTable = pgTable("audio_generation_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  prompt: text("prompt").notNull(), // يحمل backingScorePrompt أو غيره
  status: text("status").notNull().default("queued"), // queued, processing, completed, failed, retrying
  audioType: text("audio_type").notNull(), // MUSIC, SFX, VOICE
  audioAssetId: integer("audio_asset_id")
    .references(() => audioAssetsTable.id, { onDelete: "set null" }),
  errorLog: text("error_log"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAudioJobSchema = createInsertSchema(audioGenerationJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAudioJob = z.infer<typeof insertAudioJobSchema>;
export type AudioGenerationJob = typeof audioGenerationJobsTable.$inferSelect;
