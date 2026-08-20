import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const storageBackupsTable = pgTable("storage_backups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  backupType: text("backup_type").notNull(), // database_dump, asset_sync, full_archive
  storageTarget: text("storage_target").notNull(), // aws_s3, cloudflare_r2, local_archive
  status: text("status").notNull().default("completed"), // pending, processing, completed, failed
  fileSizeKey: text("file_size_key"), 
  destinationUrl: text("destination_url").notNull(), // رابط الملف الثابت والآمن لضمان عدم تلف الأصول السينمائية
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStorageBackupSchema = createInsertSchema(storageBackupsTable).omit({ id: true, createdAt: true });
export type InsertStorageBackup = z.infer<typeof insertStorageBackupSchema>;
export type StorageBackup = typeof storageBackupsTable.$inferSelect;
