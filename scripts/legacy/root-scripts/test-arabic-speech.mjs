import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function testArabicSpeech() {
  console.log("\n🎙️ [1/2] جاري توليد الصوت العربي الطبيعي عبر Microsoft Neural (ar-SA-HamedNeural)...");
  
  const text = "أهلاً بكم في استوديو كيان. تم تفعيل نظام الصوت العربي الفصيح واللهجات السينمائية بنجاح تام.";
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  const audioPath = path.join(audioDir, `arabic_voice_demo.mp3`);

  await new Promise((resolve, reject) => {
    const proc = spawn("edge-tts", [
      "--voice", "ar-SA-HamedNeural",
      "--text", text,
      "--write-media", audioPath
    ]);
    proc.on("close", (c) => c === 0 ? resolve() : reject(new Error("Edge-TTS error")));
  });

  console.log("   ✅ تم توليد الصوت العربي بنجاح فائق النقاء!");

  console.log("🎬 [2/2] جاري رندرة الفيديو ودمج الصوت العربي مع الترجمة والعلامة المائية...");
  const outputFileName = `kayan_arabic_master_${Date.now()}.mp4`;
  const finalPath = path.join(rendersDir, outputFileName);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#0f172a:s=1280x720:d=6:r=30",
    "-i", audioPath,
    "-filter_complex",
    "[0:v]drawtext=text='PRODUCED BY KAYAN AI PRODUCTIONS':x=w-tw-30:y=30:fontsize=18:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=6,drawtext=text='« أهلاً بكم في استوديو كيان - الصوت العربي مفعل بنجاح »':x=(w-tw)/2:y=h-th-80:fontsize=22:fontcolor=yellow@0.95:box=1:boxcolor=black@0.6:boxborderw=8[v]",
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
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("FFmpeg error " + code)));
  });

  const publicIp = await fetch("https://checkip.amazonaws.com").then(r => r.text()).then(t => t.trim()).catch(() => "localhost");

  console.log("\n=======================================================");
  console.log("🎉 استمع الآن إلى أول فيديو ناطق باللغة العربية الفصحى الطبيعية:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

testArabicSpeech().catch(console.error);
