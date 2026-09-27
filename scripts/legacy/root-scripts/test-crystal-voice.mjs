import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile() {
  const env = {};
  const envPaths = [".env", "/home/ubuntu/Nashash/.env"];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const idx = trimmed.indexOf("=");
          const k = trimmed.substring(0, idx).trim();
          let v = trimmed.substring(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          env[k] = v;
        }
      });
      break;
    }
  }
  return env;
}

const env = loadEnvFile();
const deepgramKey = env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY;

async function run() {
  console.log("\n🎙️ جاري توليد صوت سينمائي فائق النقاء عبر Deepgram Aura...");
  
  const rendersDir = path.resolve(process.cwd(), "uploads/renders");
  const audioDir = path.resolve(process.cwd(), "uploads/audio");
  if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const textToSpeak = "Welcome to Kayan AI Productions. The next generation cinematic studio engine is now fully active.";
  const audioPath = path.join(audioDir, `crystal_voice_${Date.now()}.mp3`);

  const res = await fetch("https://api.deepgram.com/v1/speak?model=aura-asteria-en", {
    method: "POST",
    headers: {
      "Authorization": `Token ${deepgramKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text: textToSpeak })
  });

  if (!res.ok) {
    throw new Error(`Deepgram failed: ${res.status} ${await res.text()}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(audioPath, buf);
  console.log("   ✅ تم توليد الصوت بنجاح تام!");

  const outputFileName = `kayan_crystal_demo_${Date.now()}.mp4`;
  const finalPath = path.join(rendersDir, outputFileName);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#0b132b:s=1280x720:d=6:r=30",
    "-i", audioPath,
    "-filter_complex",
    "[0:v]drawtext=text='PRODUCED BY KAYAN AI PRODUCTIONS':x=w-tw-30:y=30:fontsize=18:fontcolor=white@0.9:box=1:boxcolor=black@0.5:boxborderw=6,drawtext=text='« مرحباً بكم في استوديو كيان للإنتاج السينمائي »':x=(w-tw)/2:y=h-th-80:fontsize=24:fontcolor=yellow@0.95:box=1:boxcolor=black@0.6:boxborderw=8[v]",
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
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("FFmpeg code " + code)));
  });

  const publicIp = await fetch("https://checkip.amazonaws.com").then(r => r.text()).then(t => t.trim()).catch(() => "localhost");

  console.log("\n=======================================================");
  console.log("🎧 رابط الاستماع للصوت السينمائي البشري النقي:");
  console.log(`👉 http://${publicIp}:3000/uploads/renders/${outputFileName}`);
  console.log("=======================================================\n");
  process.exit(0);
}

run().catch(console.error);
