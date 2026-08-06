import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const actorsTable = pgTable("actors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // نساء | رجال | مراهقين | أطفال | كبار سن
  age: integer("age").notNull(),
  style: text("style").notNull(),
  imageUrl: text("image_url"),
});

export const insertActorSchema = createInsertSchema(actorsTable).omit({ id: true });
export type InsertActor = z.infer<typeof insertActorSchema>;
export type Actor = typeof actorsTable.$inferSelect;
