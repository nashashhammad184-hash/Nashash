import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const actorsTable = pgTable("actors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // رجال، نساء، مراهقين، أطفال، كبار سن
  category: text("category").notNull().default("global"),
  age: integer("age").notNull(),
  style: text("style").notNull(),
  imageUrl: text("image_url"),
  
  // Character Bible Extention - Identity & Personality
  role: text("role"),
  gender: text("gender"),
  personality: text("personality"),
  background: text("background"),
  behavior: text("behavior"),
  speakingStyle: text("speaking_style"),

  // Appearance & Wardrobe stored as robust JSONB structure
  appearance: jsonb("appearance").$type<{
    face?: string; eyes?: string; hair?: string; hairstyle?: string;
    skinTone?: string; bodyBuild?: string; distinctiveFeatures?: string;
  }>().default({}),
  wardrobe: jsonb("wardrobe").$type<{
    defaultClothing?: string; colors?: string; accessories?: string;
  }>().default({}),

  // Production Parameters
  characterPrompt: text("character_prompt"),
  negativePrompt: text("negative_prompt"),
  referenceImages: jsonb("reference_images").$type<string[]>().default([]),
  voiceId: text("voice_id"),
  voiceSettings: jsonb("voice_settings").$type<{ stability: number; clarity: number }>().default({ stability: 0.75, clarity: 0.75 }),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertActorSchema = createInsertSchema(actorsTable).omit({ id: true, createdAt: true });
export type InsertActor = z.infer<typeof insertActorSchema>;
export type Actor = typeof actorsTable.$inferSelect;
