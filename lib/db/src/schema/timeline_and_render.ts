import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { assetsTable } from "./production_pipeline";

export const timelineAndRenderTable = pgTable("timeline_and_render", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("idle"), // idle, rendering, completed, failed
  renderProgress: integer("render_progress").notNull().default(0),
  outputUrl: text("output_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});
