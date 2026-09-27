import { pgTable, serial, integer, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { shotsTable } from "./shots";

export const subtitlesTable = pgTable("subtitles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").references(() => shotsTable.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  startTime: doublePrecision("start_time").notNull().default(0),
  endTime: doublePrecision("end_time").notNull().default(0),
  orderIndex: integer("order_index").notNull().default(0),
  language: text("language").notNull().default("ar"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubtitleSchema = createInsertSchema(subtitlesTable).omit({ id: true, createdAt: true });
export type InsertSubtitle = z.infer<typeof insertSubtitleSchema>;
export type Subtitle = typeof subtitlesTable.$inferSelect;
