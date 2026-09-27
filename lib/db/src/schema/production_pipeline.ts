import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const productionPipeline = pgTable("production_pipeline", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  type: text("type").notNull().default("VIDEO_GEN"),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  payload: jsonb("payload").default({}),
  providerJobId: text("provider_job_id"),
  videoUrl: text("video_url"),
  output: jsonb("output"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const productionPipelineRelations = relations(productionPipeline, ({ one }) => ({
  project: one(projectsTable, {
    fields: [productionPipeline.projectId],
    references: [projectsTable.id],
  }),
}));

export const insertProductionPipelineSchema = createInsertSchema(productionPipeline);
export const selectProductionPipelineSchema = createSelectSchema(productionPipeline);
export type InsertProductionPipeline = z.infer<typeof insertProductionPipelineSchema>;
export type ProductionPipeline = typeof productionPipeline.$inferSelect;
