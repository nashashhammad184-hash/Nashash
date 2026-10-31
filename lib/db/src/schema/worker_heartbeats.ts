import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workerHeartbeatsTable = pgTable("worker_heartbeats", {
  name: text("name").primaryKey(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
