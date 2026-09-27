const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf-8');
const dbUrlLine = envContent.split('\n').find(line => line.trim().startsWith('DATABASE_URL='));

if (!dbUrlLine) {
  console.error("ERROR: DATABASE_URL not found in .env");
  process.exit(1);
}

const connectionString = dbUrlLine.split('=').slice(1).join('=').replace(/["']/g, '').trim();
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log("Connected to PostgreSQL for LipSync integration.");
    
    // إضافة حقول تتبع الـ LipSync داخل جدول اللقطات لحفظ المسار والأصل المرتجع
    const queries = [
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS lipsync_status text NOT NULL DEFAULT 'queued';",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS lipsync_provider_job_id text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS lipsync_video_url text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS lipsync_error text;"
    ];

    for (let q of queries) {
      await client.query(q);
    }

    console.log("SUCCESS: LipSync Job structural states injected into database safely with ZERO data loss!");
  } catch (err) {
    console.error("ERROR affecting database:", err);
  } finally {
    await client.end();
  }
}

run();
