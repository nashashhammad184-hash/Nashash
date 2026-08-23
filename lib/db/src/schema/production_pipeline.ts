import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. جدول الأصول الأساسي المنفصل لـ Assets ──
export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), 
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── 2. جدول وظائف العمليات الآلية المستقل (إصلاح 21) ──
// فصل تام للنظامين وعزل العمليات التلقائية الخمس (video, voice, lip_sync, audio, render) عن المهام اليدوية للبشر
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
