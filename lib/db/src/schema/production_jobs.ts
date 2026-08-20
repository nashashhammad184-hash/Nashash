import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const productionJobsTable = pgTable("production_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull(), // المعرف الخارجي من المزود
  provider: text("provider").notNull(), // runway, elevenlabs, groq, snoop etc
  status: text("status").notNull().default("queued"), // queued, processing, completed, failed
  progress: integer("progress").default(0),
  retryCount: integer("retry_count").default(0),
  inputParams: text("input_params"),
  outputResult: text("output_result"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const insertProductionJobSchema = createInsertSchema(productionJobsTable).omit({ id: true, createdAt: true });
export type InsertProductionJob = z.infer<typeof insertProductionJobSchema>;
export type ProductionJob = typeof productionJobsTable.$inferSelect;
