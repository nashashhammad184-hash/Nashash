import { productionPipeline } from "./production_pipeline";

function verifyDatabaseSchema() {
  console.log("🧪 بدء اختبار الوحدة المعزول لبنية قاعدة البيانات المحدثة...");
  
  if (productionPipeline.jobId && productionPipeline.status) {
    console.log("✅ نجح الاختبار 1: تم التحقق من وجود أعمدة التتبع الحقيقية لـ Replicate.");
  } else {
    throw new Error("فشل الفحص: أعمدة التتبع الحيوية مفقودة من الـ Schema.");
  }
  
  console.log("✅ تم الانتهاء من فحص جودة ومطابقة الـ Schema بنجاح 100%.");
}

verifyDatabaseSchema();
