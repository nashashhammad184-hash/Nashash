import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function testGoogle() {
  console.log("\n🔍 جاري فحص واختبار مفتاح Google API للصوت العربي الفصيح...");

  const googleKey = process.env.GOOGLE_TTS_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!googleKey) {
    console.error("❌ خطأ واضح: GOOGLE_TTS_API_KEY مفقود من متغيرات البيئة (Environment Variables).");
    process.exit(1);
  }

  const text = "يا هلا والله ومسهلا فيكم باستوديو كيان، الحين بنبدأ تصوير أول المشاهد السينمائية لفيلمنا الجديد.";
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

  const audioPath = path.join(audioDir, `google_arabic_${Date.now()}.mp3`);

  const payload = {
    input: { text },
    voice: { languageCode: "ar-XA", name: "ar-XA-Neural2-B" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 }
  };

  let audioContent = null;

  try {
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${googleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.audioContent) {
      audioContent = data.audioContent;
      console.log("   ✅ نجح توليد الصوت عبر Google Cloud Neural2 (Bearer Auth)!");
    } else {
      console.log("   ℹ️ محاولة عبر API Key param...");
    }
  } catch (e) {
    console.log("   ℹ️ تعذر الاتصال بالمسار الأول:", e.message);
  }

  if (!audioContent) {
    try {
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.audioContent) {
        audioContent = data.audioContent;
        console.log("   ✅ نجح توليد الصوت عبر Google Cloud Neural2 (API Key Auth)!");
      } else {
        console.log("   ❌ رد Google API:", data.error?.message || data);
      }
    } catch (e) {
      console.log("   ❌ خطأ Google:", e.message);
    }
  }

  if (!audioContent) {
    console.log("\n⚠️ فشل الاختبار لعدم القدرة على استرجاع المحتوى الصوتي.");
    process.exit(1);
  }

  fs.writeFileSync(audioPath, Buffer.from(audioContent, "base64"));
  console.log(`   📦 تم حفظ ملف الصوت العربي بنجاح (${(fs.statSync(audioPath).size / 1024).toFixed(1)} KB)`);

  const outputFileName = `kayan_google_scene_${Date.now()}.mp4`;
  const finalPath = path.join(rendersDir, outputFileName);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#0f172a:s=1280x720:d=7:r=30",
    "-i", audioPath,
    "-filter_complex",
    "[0:v]drawtext=text='PRODUCED BY KAYAN AI PRODUCTIONS':x=w-tw-30:y=30:fontsize=18:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=6,drawtext=text='« يا هلا والله ومسهلا فيكم باستوديو كيان »':x=(w-tw)/2:y=h-th-80:fontsize=24:fontcolor=yellow@0.95:box=1:boxcolor=black@0.6:boxborderw=8[v]",
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    "-pix_fmt", "yuv420p",
    finalPath
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ffmpegArgs);
    proc.on("close", (c) => c === 0 ? resolve() : reject(new Error("FFmpeg error " + c)));
  });

  const publicIp = await fetch("https://checkip.amazonaws.com").then(r => r.text()).then(t => t.trim()).catch(() => "localhost");

  console.log("\n=======================================================");
  console.log("🎉 استمع وشاهد الفيديو بصوت Google Neural2 العربي المتقن:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

testGoogle().catch(console.error);
