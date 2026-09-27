import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function produceDialectScene() {
  console.log("\n🎙️ [1/2] جاري توليد الصوت بالعامية الخليجية الطبيعية...");
  
  // النص بالعامية الخليجية العفوية
  const dialectText = "يا هلا والله ومسهلا فيكم باستوديو كيان، الحين بنبدأ تصوير أول المشاهد السينمائية لفيلمنا الجديد، وخليكم معنا.";
  
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  const audioPath = path.join(audioDir, `dialect_gulf_${Date.now()}.mp3`);

  await new Promise((resolve, reject) => {
    const proc = spawn("edge-tts", [
      "--voice", "ar-SA-HamedNeural",
      "--text", dialectText,
      "--rate", "-4%", // تهدئة طفيفة للسرعة لإعطاء نبرة درامية خليجية وقورة
      "--write-media", audioPath
    ]);
    proc.on("close", (c) => c === 0 ? resolve() : reject(new Error("Edge-TTS error")));
  });

  console.log("   ✅ تم توليد الصوت العامي بنجاح تام وبنبرة طبيعية!");

  console.log("🎬 [2/2] جاري رندرة الفيديو ودمج الصوت العامي مع الترجمة والعلامة المائية...");
  const outputFileName = `kayan_gulf_dialect_${Date.now()}.mp4`;
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
  console.log("🎉 استمع وشاهد الآن الفيديو بالصوت العامي الطبيعي:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

produceDialectScene().catch(console.error);
