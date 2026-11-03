import { z } from "zod";

export const EMOTIONS = [
  "neutral", "joy", "sadness", "anger", "fear",
  "surprise", "disgust", "romantic", "anxious", "confident"
] as const;

export const AUDAR_TAGS = [
  "[laughs]", "[curious]", "[excited]", "[sighs]",
  "[exhales]", "[mischievously]", "[whispers]", "[sarcastic]"
] as const;

export const SourceEnum = z.enum(["director", "manual", "dialogue"]);

export const AudioInstructionFieldsSchema = z.object({
  emotion: z.object({ value: z.enum(EMOTIONS), source: SourceEnum, confidence: z.number() }),
  delivery: z.object({ value: z.string().max(64), source: SourceEnum, confidence: z.number() }),
  intensity: z.object({ value: z.number().min(0).max(1), source: SourceEnum, confidence: z.number() }),
  audar_tag: z.object({ value: z.enum(AUDAR_TAGS).nullable(), source: SourceEnum, confidence: z.number() })
});

export const AudioInstructionSchema = z.object({
  version: z.string(),
  model: z.string(),
  analyzed_at: z.string(),
  input_hash: z.string(),
  fields: AudioInstructionFieldsSchema,
  reasoning: z.string().max(500)
});

export const ManualInstructionSchema = z.object({
  updated_at: z.string(),
  fields: z.object({
    emotion: z.object({ value: z.enum(EMOTIONS), source: z.literal("manual") }).partial(),
    delivery: z.object({ value: z.string().max(64), source: z.literal("manual") }).partial(),
    intensity: z.object({ value: z.number().min(0).max(1), source: z.literal("manual") }).partial(),
    audar_tag: z.object({ value: z.enum(AUDAR_TAGS).nullable(), source: z.literal("manual") }).partial()
  }).partial()
});

export const GroqDirectorResponseSchema = z.object({
  emotion: z.enum(EMOTIONS),
  delivery: z.string().max(64),
  intensity: z.number().min(0).max(1),
  audar_tag: z.enum(AUDAR_TAGS).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500)
});
