import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("خطأ: لم يتم العثور على DATABASE_URL في البيئة!");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log("جاري تحديث جدول الممثلين بالحقول الجديدة للـ Character Bible...");
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // إضافة الحقول الجديدة بأمان إذا لم تكن موجودة
    await client.query(`
      ALTER TABLE actors 
      ADD COLUMN IF NOT EXISTS face_description TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS hair TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS eyes TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS appearance TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS clothing TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS distinctive_features TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS psychological_traits TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS background TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS speech_style TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS voice TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS voice_id TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS reference_images TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS character_prompt TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS negative_prompt TEXT DEFAULT '';
    `);
    
    await client.query('COMMIT');
    console.log("✅ تم تحديث قاعدة البيانات بنجاح وبأمان دون فقدان البيانات الحالية!");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("❌ حدث خطأ أثناء التحديث:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
