import pg from "pg";
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
let dbUrl = process.env.DATABASE_URL;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(/DATABASE_URL=["']?([^"'\n\r]+)["']?/);
  if (match) dbUrl = match[1];
}

if (!dbUrl) {
  console.error("❌ لم يتم العثور على DATABASE_URL في .env");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timeline_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER,
      clip_id INTEGER,
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

    CREATE TABLE IF NOT EXISTS render_jobs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      output_video_url TEXT,
      total_duration DOUBLE PRECISION DEFAULT 0,
      render_settings TEXT,
      logs TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP
    );
  `);
  console.log("✅ تم إنشاء وتأكيد جداول timeline_items و render_jobs بنجاح في PostgreSQL!");
  await pool.end();
}

run().catch((err) => {
  console.error("❌ خطأ أثناء إنشاء الجداول:", err.message);
  process.exit(1);
});
