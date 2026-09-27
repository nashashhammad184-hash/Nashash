import { pgTable, uuid, integer, text, jsonb, doublePrecision, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const renderJobsTable = pgTable("render_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("QUEUED"),
  input: jsonb("input").notNull().default({}),
  outputPath: text("output_path"),
  outputUrl: text("output_url"),
  duration: doublePrecision("duration"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  probe: jsonb("probe"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const insertRenderJobSchema = createInsertSchema(renderJobsTable).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
});

export type InsertRenderJob = z.infer<typeof insertRenderJobSchema>;
export type RenderJobRow = typeof renderJobsTable.$inferSelect;

// نوع مُبسّط يستخدمه renderEngine
export type RenderStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
