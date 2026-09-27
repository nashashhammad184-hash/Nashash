const http = require('http');

console.log("🧪 بدء فحص الترمينال الصارم لـ Actors CRUD Pipeline...");

const PORT = process.env.PORT || 3000;
let testActorId = null;

// دالة مساعدة لعمل طلبات HTTP المباشرة للسيرفر المحلي
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });
    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTestPipeline() {
  try {
    // ----------------------------------------------------
    // الاختبار 1: إنشاء ممثل رقمي جديد (POST)
    // ----------------------------------------------------
    console.log("\n⚡ [TEST 1] جاري إرسال طلب إنشاء ممثل حقيقي عبر الـ API...");
    const createOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/actors',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    const actorPayload = {
      name: "ممثل فحص النظام التلقائي",
      type: "عربي",
      age: 28,
      style: "أداء نبرة غامضة، تفاعل حاد مع الكاميرا"،
      imageUrl: "https://ibb.co"
    };

    const createResult = await makeRequest(createOptions, actorPayload);
    
    if (createResult.statusCode === 211 || createResult.statusCode === 201) {
      testActorId = createResult.body.id;
      console.log(`✅ نجح الاختبار 1: تم إنشاء الممثل بنجاح في PostgreSQL بـ ID رقم: #${testActorId}`);
    } else {
      throw new Error(`فشل الإنشاء! الكود العائد: ${createResult.statusCode}`);
    }

    // ----------------------------------------------------
    // الاختبار 2: تحديث أسلوب أداء الممثل (PATCH)
    // ----------------------------------------------------
    console.log(`\n⚡ [TEST 2] جاري تحديث أسلوب الأداء للممثل رقم #${testActorId}...`);
    const patchOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/actors/${testActorId}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    };
    const updatePayload = {
      style: "تحديث الأسلوب: أداء درامي سينمائي فائق الدقة"
    };

    const patchResult = await makeRequest(patchOptions, updatePayload);
    
    if (patchResult.statusCode === 200 && patchResult.body.style.includes("تحديث")) {
      console.log(`✅ نجح الاختبار 2: تم تعديل البيانات في الـ DB وانعكس النص الجديد: "${patchResult.body.style}"`);
    } else {
      throw new Error(`فشل التحديث الفعلي! الكود العائد: ${patchResult.statusCode}`);
    }

    // ----------------------------------------------------
    // الاختبار 3: الحذف النهائي للممثل الصوري (DELETE)
    // ----------------------------------------------------
    console.log(`\n⚡ [TEST 3] جاري تنظيف خط الإنتاج وحذف الممثل رقم #${testActorId}...`);
    const deleteOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/actors/${testActorId}`,
      method: 'DELETE'
    };

    const deleteResult = await makeRequest(deleteOptions);
    
    if (deleteResult.statusCode === 204) {
      console.log(`✅ نجح الاختبار 3: تم مسح السجل وإغلاق الحلقة بنجاح تال.`);
      console.log("\n📊 --------------------------------------------------");
      console.log("🚀 النتيجة النهائية للاختبار الميداني: ACTORS CRUD = PASS");
      console.log("--------------------------------------------------\n");
    } else {
      throw new Error(`فشل الحذف من قاعدة البيانات! الكود العائد: ${deleteResult.statusCode}`);
    }

  } catch (error) {
    console.error("\n🔴 خطأ كارثي أثناء الفحص التشغيلي للـ CRUD:", error.message);
    console.log("💡 تأكد من تشغيل الـ Express Server المحلي على الخلفية أولاً قبل تشغيل الفحص.");
  }
}

runTestPipeline();
