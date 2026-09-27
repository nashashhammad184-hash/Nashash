import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function produceFalCinemaVoice() {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) { console.error("FAL_KEY env var is required"); process.exit(1); }
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

  const dialectText = "يا هلا والله ومسهلا فيكم باستوديو كيان، الحين بنبدأ تصوير أول المشاهد السينمائية لفيلمنا الجديد، وخليكم معنا.";

  console.log("\n🎙️ [1/2] جاري توليد صوت عامي تمثيلي بشري حقيقي عبر fal.ai (ElevenLabs & MiniMax)...");

  // 1. استدعاء fal.ai بمفتاحك الحقيقي
  let audioUrl = null;
  
  // تجربة ElevenLabs v3 السحابي عبر fal.ai
  try {
    console.log("   (جاري الاتصال بسيرفرات fal.ai المتقدمة)...");
    const res = await fetch("https://fal.run/fal-ai/elevenlabs/tts/eleven-v3", {
      method: "POST",
      headers: {
        "Authorization": `Key ${falKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: dialectText
      })
    });

    const data = await res.json();
    if (data.audio?.url) {
      audioUrl = data.audio.url;
      console.log("   ✅ نجح التوليد عبر fal-ai/elevenlabs بنبرة تمثيلية بشرية كاملة!");
    } else {
      console.log("   ℹ️ جاري التحويل لموديل fal.ai MiniMax البديل:", data.detail || data.message || "");
    }
  } catch (e) {
    console.log("   ℹ️ محاولة الموديل الثاني:", e.message);
  }

  // في حال الرغبة بموديل MiniMax
  if (!audioUrl) {
    try {
      const res = await fetch("https://fal.run/fal-ai/minimax/speech-01", {
        method: "POST",
        headers: {
          "Authorization": `Key ${falKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: dialectText
        })
      });
      const data = await res.json();
      if (data.audio?.url) {
        audioUrl = data.audio.url;
        console.log("   ✅ نجح التوليد عبر fal-ai/minimax بنبرة عامية بشرية!");
      } else {
        console.error("   ❌ رد fal.ai:", data);
      }
    } catch (e) {
      console.error("   ❌ خطأ fal.ai:", e.message);
    }
  }

  if (!audioUrl) {
    throw new Error("تعذر استخراج رابط الصوت من fal.ai");
  }

  // تنزيل ملف الصوت البشري الحقيقي
  const audioFilePath = path.join(audioDir, `fal_human_voice_${Date.now()}.mp3`);
  const audioRes = await fetch(audioUrl);
  fs.writeFileSync(audioFilePath, Buffer.from(await audioRes.arrayBuffer()));
  console.log(`   📦 تم تحميل ملف الصوت البشري بنجاح (${(fs.statSync(audioFilePath).size / 1024).toFixed(1)} KB)`);

  // 2. دمج الصوت في فيديو سينمائي
  console.log("\n🎬 [2/2] جاري دمج الصوت التمثيلي مع الفيديو والترجمة والعلامة المائية...");
  const outputFileName = `kayan_human_voice_${Date.now()}.mp4`;
  const finalPath = path.join(rendersDir, outputFileName);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#0f172a:s=1280x720:d=7:r=30",
    "-i", audioFilePath,
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
  console.log("🎉 استمع الآن إلى الصوت العامي البشري التمثيلي الحقيقي المولد بـ fal.ai:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

produceFalCinemaVoice().catch(console.error);
