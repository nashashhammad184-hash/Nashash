import pg from "pg";

const actors = [
  {"id": 1, "name": "ليلى (ياسمين صبري)", "type": "نساء", "category": "global", "age": 32, "style": "شرقية أرستقراطية", "image_url": "https://ibb.co"},
  {"id": 2, "name": "قمر (هيفاء وهبي)", "type": "نساء", "category": "global", "age": 35, "style": "حادة وجاذبية سينمائية", "image_url": "https://ibb.co"},
  {"id": 3, "name": "ديالا (أنجلينا جولي)", "type": "نساء", "category": "global", "age": 42, "style": "درامية قوية وعظام فك بارزة", "image_url": "https://ibb.co"},
  {"id": 4, "name": "سحر (ميجان فوكس)", "type": "نساء", "category": "global", "age": 38, "style": "عيون ثعلبية متمردة", "image_url": "https://ibb.co"},
  {"id": 5, "name": "نادين (سكارليت جوهانسون)", "type": "نساء", "category": "global", "age": 36, "style": "كلاسيكية مناسبة للأكشن", "image_url": "https://ibb.co"},
  {"id": 6, "name": "سميرة (غابرييلي يونيون)", "type": "نساء", "category": "global", "age": 48, "style": "بشرة سمراء داكنة وقوية", "image_url": "https://ibb.co"},
  {"id": 7, "name": "كارينا (آنا لينيكوفا)", "type": "نساء", "category": "global", "age": 28, "style": "أوروبية باردة وعيون زرقاء", "image_url": "https://ibb.co"},
  {"id": 8, "name": "مايا (كارما آر إكس)", "type": "نساء", "category": "global", "age": 30, "style": "حادة مناسبة لعالم الغموض", "image_url": "https://ibb.co"},
  {"id": 9, "name": "أمل (عاليا حديد)", "type": "نساء", "category": "global", "age": 33, "style": "شرق أوسطية غامضة", "image_url": "https://ibb.co"},
  {"id": 10, "name": "ريما (ثاندي نيوتن)", "type": "نساء", "category": "global", "age": 46, "style": "أفرو-أوروبية ذكية ودقيقة", "image_url": "https://ibb.co"},
  {"id": 11, "name": "سلمى (كاميرون دياز)", "type": "نساء", "category": "global", "age": 52, "style": "حيوية، غربية شقراء", "image_url": "https://ibb.co"},
  {"id": 12, "name": "فرح (ميشيل هانتر)", "type": "نساء", "category": "global", "age": 31, "style": "عصرية مناسبة للدراما والواقعية", "image_url": "https://ibb.co"},
  {"id": 13, "name": "هاندا (هاندا أرتشيل)", "type": "نساء", "category": "global", "age": 29, "style": "تركية جذابة وناعمة", "image_url": "https://ibb.co"},
  {"id": 14, "name": "صقر (أرطغرل)", "type": "رجال", "category": "global", "age": 40, "style": "بنية عريضة، قائد تاريخي صارم", "image_url": "https://ibb.co"},
  {"id": 15, "name": "منذر (منذر رياحنة)", "type": "رجال", "category": "global", "age": 45, "style": "ملامح بدوية حادة، عمق شرقي", "image_url": "https://ibb.co"},
  {"id": 16, "name": "فارس (جيرالت من ريفيا)", "type": "رجال", "category": "global", "age": 39, "style": "بنية جبلية ضخمة للأساطير", "image_url": "https://ibb.co"},
  {"id": 17, "name": "سيف (براد بيت)", "type": "رجال", "category": "global", "age": 50, "style": "وسامة كلاسيكية ورشاقة حركية", "image_url": "https://ibb.co"},
  {"id": 18, "name": "حكيم (توم هانكس)", "type": "رجال", "category": "global", "age": 58, "style": "ملامح دافئة وقدرات درامية عالية", "image_url": "https://ibb.co"},
  {"id": 20, "name": "إدريس (إدريس إلبا)", "type": "رجال", "category": "global", "age": 48, "style": "بشرة سمراء، بنية ضخمة وصوت جهوري", "image_url": "https://ibb.co"},
  {"id": 21, "name": "بوراق (بوراق أوزجيفيت)", "type": "رجال", "category": "global", "age": 36, "style": "تركية حادة ولحية كثيفة", "image_url": "https://ibb.co"},
  {"id": 22, "name": "كريم (آصف مندفي)", "type": "رجال", "category": "global", "age": 42, "style": "شرق أوسطية مألوفة للتحقيق", "image_url": "https://ibb.co"},
  {"id": 23, "name": "زينة (سادي سينك)", "type": "مراهقين", "category": "global", "age": 18, "style": "شعر أحمر نمش متمردة", "image_url": "https://ibb.co"},
  {"id": 24, "name": "خالد (تيموثي شالاميه)", "type": "مراهقين", "category": "global", "age": 19, "style": "مراهق شرقي نحيف وذكي", "image_url": "https://ibb.co"},
  {"id": 25, "name": "لوران (كالب ماكلوغلين)", "type": "مراهقين", "category": "global", "age": 17, "style": "شاب أسمر مفعم بالحيوية", "image_url": "https://ibb.co"},
  {"id": 26, "name": "يوسف (طفل شرق أوسطي)", "type": "أطفال", "category": "global", "age": 10, "style": "بريء وذكي", "image_url": "https://ibb.co"},
  {"id": 27, "name": "تالا (طفلة أفريقية)", "type": "أطفال", "category": "global", "age": 8, "style": "حيوية ومرحة كيرلي", "image_url": "https://ibb.co"},
  {"id": 28, "name": "مراد الصغير (طفل تركي)", "type": "أطفال", "category": "global", "age": 11, "style": "مناسب للفلاش باك", "image_url": "https://ibb.co"},
  {"id": 29, "name": "باسل (مورغان فريمان)", "type": "كبار سن", "category": "global", "age": 75, "style": "حكيم أسمر، تجاعيد عميقة وصوت مؤثر", "image_url": "https://ibb.co"},
  {"id": 30, "name": "نعمان (غسان مسعود)", "type": "كبار سن", "category": "global", "age": 72, "style": "ملامح تاريخية حكيمة وهيبة عربية", "image_url": "https://ibb.co"},
  {"id": 31, "name": "خديجة (منى واصف)", "type": "كبار سن", "category": "global", "age": 68, "style": "الأم والجدة الشرقية الصارمة", "image_url": "https://ibb.co"}
];

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres" });
  console.log("جاري مسح وحقن بيانات الممثلين الـ 31 المعتمدين...");
  try {
    await pool.query("DELETE FROM actors");
    for (const actor of actors) {
      await pool.query(
        "INSERT INTO actors (id, name, type, category, age, style, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [actor.id, actor.name, actor.type, actor.category, actor.age, actor.style, actor.image_url]
      );
    }
    console.log("✔ تم تحديث قاعدة البيانات بنجاح بكامل طاقم الاستوديو الرقمي!");
  } catch (err) {
    console.error("خطأ أثناء الحقن:", err.message);
  } finally {
    pool.end();
  }
}
run();
