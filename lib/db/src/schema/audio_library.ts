import { pgTable, serial, integer, text, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { shotsTable } from "./shots";

export const audioLibraryAssetsTable = pgTable("audio_library_assets", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  assetType: text("asset_type").notNull(), // music, ambience, foley, sfx
  tags: jsonb("tags").default([]),
  duration: real("duration").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  creator: text("creator"),
  license: text("license").notNull(),
  licenseUrl: text("license_url"),
  audioUrl: text("audio_url").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shotAudioAssetsTable = pgTable("shot_audio_assets", {
  id: serial("id").primaryKey(),
  shotId: integer("shot_id").notNull().references(() => shotsTable.id, { onDelete: "cascade" }),
  libraryAssetId: integer("library_asset_id").references(() => audioLibraryAssetsTable.id),
  assetType: text("asset_type").notNull(),
  audioUrl: text("audio_url"),
  startTime: real("start_time").notNull().default(0),
  endTime: real("end_time").notNull(),
  volume: real("volume").notNull().default(1.0),
  fadeIn: real("fade_in").notNull().default(0),
  fadeOut: real("fade_out").notNull().default(0),
  trackOrder: integer("track_order").notNull().default(0),
  status: text("status").notNull().default("proposed"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
});
