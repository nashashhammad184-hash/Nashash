import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbUrl = process.env.DATABASE_URL;
const envPath = path.join(__dirname, '../../.env');
if (!dbUrl && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^DATABASE_URL=(.*)$/m);
  if (match) dbUrl = match[1].trim().replace(/^["']|["']$/g, '');
}

async function run() {
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query('ALTER TABLE edit_clips ADD COLUMN IF NOT EXISTS shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL;');
    console.log('SUCCESS: shot_id column added to edit_clips table.');
    const res = await client.query('SELECT * FROM edit_clips LIMIT 5;');
    console.log('Timeline Items Read Success:', res.rows);
    await client.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
run();
