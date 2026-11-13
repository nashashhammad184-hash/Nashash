import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { actorsTable } from "./actors";

export const characterVoiceProfilesTable = pgTable("character_voice_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => actorsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  gender: text("gender"),
  dialect: text("dialect").notNull(),
  engine: text("engine").notNull(),
  voiceGgufPath: text("voice_gguf_path"),
  voiceConfig: jsonb("voice_config").default({}),
  version: integer("version").default(1),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  refWavPath: text("ref_wav_path"),
  refText: text("ref_text"),
});
