import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function testSmartArabic() {
  console.log("\n🎙️ [1/2] جاري توليد الصوت العربي عبر المحرك الذكي (Google / fal.ai)...");
  
  const text = "في عمق الصحراء العربية، تنطلق أولى رحلات استوديو كيان لإنتاج روائع السينما بالذكاء الاصطناعي.";
  const res = await fetch("http://localhost:3000/api/voice/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, dialect: "classic_male" })
  });

  const data = await res.json();
  if (!data.success || !data.audioUrl) {
    throw new Error("فشل توليد الصوت: " + JSON.stringify(data));
  }

  console.log(`   ✅ تم إنتاج الصوت بنجاح عبر مزود: [${data.provider}] (الحجم: ${(data.fileSize / 1024).toFixed(1)} KB)`);

  console.log("🎬 [2/2] جاري دمج الصوت الجديد في فيديو سينمائي عالي الدقة...");
  const audioLocalPath = path.resolve(process.cwd(), data.audioUrl.replace(/^\//, ""));
  const outputFileName = `kayan_smart_arabic_${Date.now()}.mp4`;
  const finalPath = path.resolve(process.cwd(), "uploads/renders", outputFileName);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#0b132b:s=1280x720:d=6:r=30",
    "-i", audioLocalPath,
    "-filter_complex",
    "[0:v]drawtext=text='PRODUCED BY KAYAN AI PRODUCTIONS':x=w-tw-30:y=30:fontsize=18:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=6,drawtext=text='« في عمق الصحراء العربية، تنطلق أولى رحلات استوديو كيان »':x=(w-tw)/2:y=h-th-80:fontsize=22:fontcolor=yellow@0.95:box=1:boxcolor=black@0.6:boxborderw=8[v]",
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
  console.log("🎉 استمع وشاهد الآن الفيديو بالصوت العربي الفصيح الجديد:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

testSmartArabic().catch(console.error);
