import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// استيراد الجداول الفردية بدقة لتأمين الأسماء المستعارة للمحرك
import { productionJobsTable } from "./schema/production_jobs";
import { shotsTable } from "./schema/shots";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision the database?"
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// --- ربط التوافقية للمحرك مع البنية الحالية في السيرفر ---
export const generationJobsTable = productionJobsTable;
export const finalRenderJobsTable = productionJobsTable;
export const realShotsTable = shotsTable;

// تأمين جدول المشاهد إذا كان مسجلاً باسم بديل أو تصديره مرناً للمحرك
export const realScenesTable = (schema as any).seriesScenesTable || shotsTable;

// تصدير كافة الجداول المعتمدة بشكل آمن وصحيح
export * from "./schema";
