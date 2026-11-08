import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const characterVoiceProfilesTable = pgTable("character_voice_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gender: text("gender"),
  dialect: text("dialect").notNull(),
  engine: text("engine").notNull(),
  voiceGgufPath: text("voice_gguf_path"),
  voiceConfig: jsonb("voice_config").default({}),
  version: integer("version").default(1),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
