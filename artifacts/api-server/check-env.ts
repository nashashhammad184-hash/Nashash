import "dotenv/config";
import pg from "pg";

console.log("=== فحص بيئة عمل ستوديو كيان AI ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "✔ موجودة" : "❌ مفقودة");
console.log("GROQ_API_KEY:", process.env.GROQ_API_KEY ? "✔ موجودة" : "⚠ مفقودة (سيتم استخدام الـ Fallback)");

if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  pool.query("SELECT NOW()", (err, res) => {
    if (err) {
      console.error("❌ فشل الاتصال بقاعدة البيانات:", err.message);
    } else {
      console.log("✔ تم الاتصال بنجاح بقاعدة البيانات برقم تسلسلي للوقت:", res.rows[0].now);
    }
    pool.end();
  });
}
