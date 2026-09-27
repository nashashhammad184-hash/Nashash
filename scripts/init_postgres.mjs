import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf-8");
const match = env.match(/DATABASE_URL=["']?([^"'\n\r]+)["']?/);
if (!match) {
  console.error("❌ لم يتم العثور على DATABASE_URL في .env");
  process.exit(1);
}

const targetUrl = new URL(match[1]);
const targetUser = decodeURIComponent(targetUrl.username || "postgres");
const targetPass = decodeURIComponent(targetUrl.password || "");
const targetDb = targetUrl.pathname.replace(/^\//, "") || "nashash";

const adminPool = new pg.Pool({
  host: "/var/run/postgresql",
  user: "postgres",
  database: "postgres",
});

async function main() {
  try {
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${targetUser}') THEN
          CREATE ROLE "${targetUser}" WITH SUPERUSER LOGIN PASSWORD '${targetPass}';
        ELSE
          ALTER ROLE "${targetUser}" WITH PASSWORD '${targetPass}';
        END IF;
      END
      $$;
    `);

    const dbCheck = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDb]);
    if (dbCheck.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE "${targetDb}" OWNER "${targetUser}"`);
    }

    console.log("✅ تم إعداد المستخدم وقاعدة البيانات بنجاح!");
  } catch (err) {
    console.error("❌ خطأ أثناء إعداد قاعدة البيانات:", err.message);
  } finally {
    await adminPool.end();
  }
}

main();
