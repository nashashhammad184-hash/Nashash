import pg from "pg";
import fs from "fs";

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync(".env")) {
  const envContent = fs.readFileSync(".env", "utf-8");
  const match = envContent.match(/DATABASE_URL=["']?([^"'\n\r]+)["']?/);
  if (match) dbUrl = match[1];
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timeline_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
      clip_id INTEGER REFERENCES edit_clips(id) ON DELETE SET NULL,
      asset_id TEXT,
      asset_url TEXT,
      track TEXT NOT NULL,
      start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      duration DOUBLE PRECISION NOT NULL DEFAULT 0,
      end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      metadata TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✅ تم إنشاء جدول timeline_items بنجاح تام في PostgreSQL!");
  await pool.end();
}

run().catch(console.error);
