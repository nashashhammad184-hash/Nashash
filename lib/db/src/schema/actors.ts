import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 1. جدول الممثلين الأساسي (مؤمن ومحافظ على البيانات القديمة)
export const actorsTable = pgTable("actors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  category: text("category").notNull().default("global"),
  age: integer("age").notNull(),
  style: text("style").notNull(),
  imageUrl: text("image_url").$type<string>(),
  
  // ── PRESERVED COLUMNS (للمحافظة على الـ 31 ممثلاً الحاليين) ──
  gender: text("gender"),
  eyeColor: text("eye_color"),
  hairStyleOld: text("hair_style"),
  physicalDescription: text("physical_description"),
  // KAYAN-FIX-06: fixed synthetic face reference for I2V.
  canonicalFaceImagePath: text("canonical_face_image_path"),
  personalityTraits: text("personality_traits"),
  backstory: text("backstory"),
  clothingPrompt: text("clothing_prompt"),
  characterMasterPrompt: text("character_master_prompt"),
  characterNegativePrompt: text("character_negative_prompt"),
  faceReferenceUrl: text("face_reference_url"),
  bodyReferenceUrl: text("body_reference_url"),
  secondaryReferenceUrl: text("secondary_reference_url"),
  voiceProvider: text("voice_provider"),
  clothing: text("clothing"),
  psychologicalTraits: text("psychological_traits"),
  speechStyle: text("speech_style"),
  voice: text("voice"),
  referenceImages: text("reference_images"),
  role: text("role"),
  appearance: text("appearance"),
  wardrobe: text("wardrobe"),
  createdAt: timestamp("created_at"),

  // ── CHARACTER BIBLE NEW EXTENSIONS (إصلاح 9) ──
  faceDescription: text("face_description"),
  eyes: text("eyes"),
  hair: text("hair"),
  hairstyle: text("hairstyle"),
  skinDescription: text("skin_description"),
  bodyDescription: text("body_description"),
  distinctiveFeatures: text("distinctive_features"),
  defaultWardrobe: text("default_wardrobe"),
  wardrobeColors: text("wardrobe_colors"),
  accessories: text("accessories"),
  personality: text("personality"),
  background: text("background"),
  behavior: text("behavior"),
  speakingStyle: text("speaking_style"),
  characterPrompt: text("character_prompt"),
  negativePrompt: text("negative_prompt"),
  voiceId: text("voice_id"),
  voiceSettings: text("voice_settings"),
});

export const insertActorSchema = createInsertSchema(actorsTable).omit({ id: true });
export type InsertActor = z.infer<typeof insertActorSchema>;
export type Actor = typeof actorsTable.$inferSelect;


// 2. ── CHARACTER REFERENCES TABLE (إصلاح 10) ──
export const characterReferencesTable = pgTable("character_references", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id")
    .notNull()
    .references(() => actorsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id"), // nullable تلقائياً
  assetUrl: text("asset_url").notNull(),
  referenceType: text("reference_type").notNull().default("image"), 
  isPrimary: boolean("is_primary").notNull().default(false),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCharacterReferenceSchema = createInsertSchema(characterReferencesTable).omit({ id: true });
export type InsertCharacterReference = z.infer<typeof insertCharacterReferenceSchema>;
export type CharacterReference = typeof characterReferencesTable.$inferSelect;
