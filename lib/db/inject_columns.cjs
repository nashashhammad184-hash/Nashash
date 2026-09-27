const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// قراءة ملف الـ .env الرئيسي من المجلد الأب
const envPath = path.join(__dirname, '../../.env');
if (!fs.existsSync(envPath)) {
  console.error("ERROR: .env file not found at " + envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const dbUrlLine = envContent.split('\n').find(line => line.trim().startsWith('DATABASE_URL='));

if (!dbUrlLine) {
  console.error("ERROR: DATABASE_URL not found in .env");
  process.exit(1);
}

const connectionString = dbUrlLine.split('=')[1].replace(/["']/g, '').trim();
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log("Connected to PostgreSQL successfully from database workspace.");
    
    const queries = [
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS voice_id text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS provider text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS provider_job_id text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'idle';",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS audio_url text;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS duration integer;",
      "ALTER TABLE shots ADD COLUMN IF NOT EXISTS error text;"
    ];

    for (let q of queries) {
      await client.query(q);
    }

    console.log("SUCCESS: Voice Pipeline columns successfully injected into table with ZERO data loss!");
  } catch (err) {
    console.error("ERROR affecting database:", err);
  } finally {
    await client.end();
  }
}

run();
