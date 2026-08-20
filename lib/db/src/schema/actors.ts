import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const actorsTable = pgTable("actors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), 
  category: text("category").notNull().default("global"),
  age: integer("age").notNull(),
  style: text("style").notNull(), 
    imageUrl: text("image_url"),
  faceDescription: text("face_description").notNull().default(""),
  hair: text("hair").notNull().default(""),
  eyes: text("eyes").notNull().default(""),
  appearance: text("appearance").notNull().default(""),
  clothing: text("clothing").notNull().default(""),
  distinctiveFeatures: text("distinctive_features").notNull().default(""),
  psychologicalTraits: text("psychological_traits").notNull().default(""),
  background: text("background").notNull().default(""),
  speechStyle: text("speech_style").notNull().default(""),
  voice: text("voice").notNull().default(""),
  voiceId: text("voice_id").notNull().default(""),
  referenceImages: text("reference_images").notNull().default(""),
  characterPrompt: text("character_prompt").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""), 
  
  // --- Character Bible Cinematic Features (هوية حقيقية وثابتة) ---
  gender: text("gender"), 
  eyeColor: text("eye_color"), 
  hairStyle: text("hair_style"), 
  physicalDescription: text("physical_description"), 
  personalityTraits: text("personality_traits"), 
  backstory: text("backstory"), 
  
  // --- Strictly Consistent Prompts ---
  clothingPrompt: text("clothing_prompt"), 
  characterMasterPrompt: text("character_master_prompt"), 
  characterNegativePrompt: text("character_negative_prompt"), 
  
  // --- Multiple Reference Images (Assets System) ---
  faceReferenceUrl: text("face_reference_url"), 
  bodyReferenceUrl: text("body_reference_url"), 
  secondaryReferenceUrl: text("secondary_reference_url"), 
  
  // --- Voice Identity & Lip Sync ---
  voiceId: text("voice_id"), 
  voiceProvider: text("voice_provider").default("elevenlabs")
});

export const insertActorSchema = createInsertSchema(actorsTable).omit({ id: true });
export type InsertActor = z.infer<typeof insertActorSchema>;
export type Actor = typeof actorsTable.$inferSelect;
