/**
 * LEGACY / TEST ONLY — NOT IN PRODUCTION PATH.
 * KAYAN-LEGAL-00: references real-person images. DISABLED for Production.
 * Must not be imported from artifacts/api-server/src.
 */
import { db, actorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const verifiedActorsList = [
  { id: 1, imageUrl: "https://ibb.co" }, // ليلى (ياسمين صبري)
  { id: 2, imageUrl: "https://ibb.co" }, // قمر (هيفاء وهبي)
  { id: 3, imageUrl: "https://i.ibb.co/ZRXTVsNy/image.jpg" }          // ديالا (أنجلينا جولي)
];

async function runInjection() {
  console.log("⏳ جاري بدء حقن الروابط الثلاثية الحقيقية والمحققة داخل قاعدة البيانات...");
  
  let successCount = 0;
  for (const actor of verifiedActorsList) {
    try {
      const updateResult = await db
        .update(actorsTable)
        .set({ imageUrl: actor.imageUrl })
        .where(eq(actorsTable.id, actor.id))
        .returning();
        
      if (updateResult.length > 0) {
        console.log(`✅ تم بنجاح تحديث حقل الصورة للممثل رقم #${actor.id}`);
        successCount++;
      }
    } catch (error) {
      console.error(`❌ فشل تحديث الممثل رقم #${actor.id} بسبب خطأ:`, error);
    }
  }
  
  console.log(`\n🎉 اكتمل الإنجاز! تم ربط وحقن صور ${successCount} ممثلات رقميات بنجاح تام.`);
  process.exit(0);
}

runInjection().catch((err) => {
  console.error("❌ حدث خطأ غير متوقع أثناء تشغيل سكربت الحقن:", err);
  process.exit(1);
});
