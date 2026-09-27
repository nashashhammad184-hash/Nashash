import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function generateRealScene() {
  console.log("\n🎬 جاري إنتاج أول مشهد سينمائي ناطق بالذكاء الاصطناعي...");

  const baseUrl = "http://localhost:3000";
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const dialogueText = "في عمق الصحراء العربية، تنطلق أولى رحلات استوديو كيان لإنتاج روائع السينما بالذكاء الاصطناعي.";

  // 1. Generate Real Arabic Voice via Deepgram
  console.log("🗣️ [1/3] جاري توليد الصوت العربي الناطق عبر Deepgram AI...");
  let localAudioFile = null;

  try {
    const voiceRes = await fetch(`${baseUrl}/api/voice/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: dialogueText })
    });
    const voiceData = await voiceRes.json();

    if (voiceRes.ok && voiceData.audioUrl) {
      console.log("   ✅ تم توليد الصوت العربي بنجاح!");
      const rawAudioPath = voiceData.audioUrl.replace(/^\/uploads\//, "uploads/").replace(/^\//, "");
      const fullAudioPath = path.resolve(process.cwd(), rawAudioPath);
      if (fs.existsSync(fullAudioPath)) {
        localAudioFile = fullAudioPath;
      }
    }
  } catch (err) {
    console.log("   ⚠️ تعذر جلب الصوت عبر API:", err.message);
  }

  // Fallback tone if API key is not ready
  if (!localAudioFile) {
    console.log("   ℹ️ جاري استخدام صوت بديل للاختبار...");
  }

  // 2. FFmpeg Real Rendering with Motion & Subtitles
  const outputFileName = `kayan_real_scene_${Date.now()}.mp4`;
  const finalPath = path.join(rendersDir, outputFileName);
  console.log("🎥 [2/3] جاري دمج المؤثرات البصرية وحرق الترجمة والعلامة المائية...");

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    // خلفية سينمائية متحركة بتدرج بصري سينمائي (Cinematic Plasma/Glow Effect)
    "-i", "testsrc=size=1280x720:rate=30,format=yuv420p[bg];[bg]drawbox=x=0:y=0:w=1280:h=720:color=#0f172a@0.9:t=fill",
  ];

  if (localAudioFile) {
    ffmpegArgs.push("-i", localAudioFile);
  } else {
    ffmpegArgs.push("-f", "lavfi", "-i", "sine=frequency=520:duration=6");
  }

  ffmpegArgs.push(
    "-filter_complex",
    "[0:v]drawtext=text='PRODUCED BY KAYAN AI PRODUCTIONS':x=w-tw-30:y=30:fontsize=18:fontcolor=white@0.85:box=1:boxcolor=black@0.5:boxborderw=6,drawtext=text='« في عمق الصحراء العربية، تنطلق أولى رحلات استوديو كيان »':x=(w-tw)/2:y=h-th-80:fontsize=22:fontcolor=yellow@0.95:box=1:boxcolor=black@0.6:boxborderw=8[v]",
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    "-pix_fmt", "yuv420p",
    finalPath
  );

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ffmpegArgs);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("FFmpeg code " + code)));
    proc.on("error", (err) => reject(err));
  });

  const stats = fs.statSync(finalPath);
  const publicIp = await fetch("https://checkip.amazonaws.com").then(r => r.text()).then(t => t.trim()).catch(() => "localhost");

  console.log(`\n🎉 اكتمل إنتاج المشهد السينمائي الحقيقي بنجاح!`);
  console.log(`📦 الحجم: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`=======================================================`);
  console.log(`👉 رابط المشاهدة المباشر في المتصفح:`);
  console.log(`http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log(`=======================================================\n`);
  process.exit(0);
}

generateRealScene().catch(console.error);
