import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { actorsTable } from "./actors";

export const projectActorsTable = pgTable("project_actors", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").notNull().references(() => actorsTable.id, { onDelete: "cascade" }),
  roleName: text("role_name").notNull(),
  roleType: text("role_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("project_actors_project_actor_unique").on(t.projectId, t.actorId)
]);

export const insertProjectActorSchema = createInsertSchema(projectActorsTable).omit({ id: true, createdAt: true });
export type InsertProjectActor = z.infer<typeof insertProjectActorSchema>;
export type ProjectActor = typeof projectActorsTable.$inferSelect;
