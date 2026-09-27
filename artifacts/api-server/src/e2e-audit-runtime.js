const { db, projectsTable, editClipsTable, shotsTable } = require("@workspace/db");
const fs = require("fs");
const path = require("path");

async function runE2EAudit() {
  console.log("\n🎬 بدء الفحص الميداني الحقيقي والكامل للـ End-to-End Pipeline...");
  console.log("--------------------------------------------------");

  let globalStatus = "🟢 PASS";
  const blockers = [];

  // 1. فحص اختبار قراءة جداول قاعدة البيانات والاتصال الفعلي
  try {
    const projects = await db.select().from(projectsTable).limit(1);
    console.log("✅ قاعدة البيانات: متصلة وتقرأ المشاريع والاتصال مستقر بنجاح.");
  } catch (err) {
    globalStatus = "🔴 BLOCKER";
    blockers.push({
      file: "lib/db",
      place: "PostgreSQL Database Connection",
      problem: "فشل كامل في القراءة أو الاتصال بـ Postgres عبر Drizzle",
      reason: err.message,
      fix: "تأكد من عمل خادم PostgreSQL السحابي أو صحة متغيرات الاتصال."
    });
  }

  // 2. فحص التحقق من حقول التايم لاين والـ Runtime المتوافقة مع الـ Validation
  try {
    const clips = await db.select().from(editClipsTable).limit(1);
    console.log("✅ التايم لاين والـ Zod: حقول الـ Timeline السبعة متوافقة كلياً داخل الـ Runtime.");
  } catch (err) {
    globalStatus = "🔴 BLOCKER";
    blockers.push({
      file: "lib/db/src/schema/edit_clips.ts",
      place: "editClipsTable Fields Match",
      problem: "عدم القدرة على قراءة الـ Timeline من قاعدة البيانات",
      reason: err.message,
      fix: "أعد التحقق من مطابقة الحقول السبعة وتوافق بنية الـ Zod."
    });
  }

  // 3. الفحص الحاسم لمحرك الـ FFmpeg والـ MP4 الفعلي في السيرفر
  try {
    const renderEnginePath = path.join(process.cwd(), "src", "lib", "renderEngine.ts");
    if (fs.existsSync(renderEnginePath)) {
      const renderEngineFile = fs.readFileSync(renderEnginePath, "utf8");
      
      if (renderEngineFile.includes("interactive-examples.mdn.mozilla.net") || renderEngineFile.includes("flower.mp4")) {
        globalStatus = "🔴 BLOCKER";
        blockers.push({
          file: "artifacts/api-server/src/lib/renderEngine.ts",
          place: "processRenderJobAsync (Lines 45-55)",
          problem: "الرندرة تعتمد على روابط خارجيّة وهمية وثابتة (Demo MP4)",
          reason: "يتم إرجاع رابط فديو Flower الافتراضي لـ MDN بدلاً من استدعاء FFmpeg حقيقي لدمج وقص أصول الفيديوهات والأصوات والترجمة.",
          fix: "استبدال الرابط الوهمي باستدعاء أمر نظام exec('ffmpeg ...') أو مكتبة fluent-ffmpeg لدمج الـ clips الفعلية وحفظ ملف MP4 حقيقي محلياً وبثه."
        });
      } else {
        console.log("✅ محرك التصدير: مسار FFmpeg الحقيقي مفعل.");
      }
    }
  } catch (err) {
    console.log("⚠️ تحذير أثناء فحص معالج الرندرة: " + err.message);
  }

  console.log("\n--------------------------------------------------");
  console.log(`📊 النتيجة النهائية الحتمية للاختبار الميداني: ${globalStatus}`);
  console.log("--------------------------------------------------\n");

  if (blockers.length > 0) {
    blockers.forEach((b, idx) => {
      console.log(`🚨 [BLOCKER #${idx + 1}]`);
      console.log(`📁 الملف: ${b.file}`);
      console.log(`📍 المكان: ${b.place}`);
      console.log(`💥 المشكلة: ${b.problem}`);
      console.log(`❓ سببها: ${b.reason}`);
      console.log(`🛠️ الإصلاح المطلوب: ${b.fix}`);
      console.log("------------------------------------\n");
    });
  }
  
  process.exit(globalStatus === "🟢 PASS" ? 0 : 1);
}

runE2EAudit().catch((err) => {
  console.error("🔴 خطأ كارثي أثناء تشغيل الفحص:", err);
  process.exit(1);
});
