import { pgTable, serial, text, integer, doublePrecision, timestamp, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { assetsTable } from "./assets_and_jobs";

// 1. جدول الشريان الزمني الحقيقي للمونتاج (Timeline Clips Table)
export const timelineClipsTable = pgTable("timeline_clips", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").references(() => assetsTable.id, { onDelete: "cascade" }),
  track: text("track").notNull(), // VIDEO, VOICE, MUSIC, SFX, SUBTITLE
  startTime: doublePrecision("start_time").notNull().default(0.0),
  endTime: doublePrecision("end_time").notNull(),
  timelineStart: doublePrecision("timeline_start").notNull().default(0.0),
  timelineEnd: doublePrecision("timeline_end").notNull(),
  volume: doublePrecision("volume").notNull().default(1.0),
  transition: text("transition"), // fade, crossfade, none
  effects: jsonb("effects").default({}),
  subtitleReference: text("subtitle_reference"),
  clipOrder: integer("clip_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 2. جدول وظائف الرندرة والدمج الفعلي (Final Render Jobs Table)
export const finalRenderJobsTable = pgTable("final_render_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("QUEUED"), // QUEUED, PROCESSING, COMPLETED, FAILED, RETRY
  progress: integer("progress").notNull().default(0),
  errorLog: text("error_log"),
  outputAssetId: integer("output_asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
  continuityCheckResult: text("continuity_check_result").notNull().default("PASS"), // PASS, WARNING, FAIL
  continuityReport: jsonb("continuity_report").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
