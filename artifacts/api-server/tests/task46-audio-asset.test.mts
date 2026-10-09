import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveAudioBuffer, makeSafeAudioName, getAudioDir } from "../src/lib/audioAssets";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t46-"));

// ═══ TEST-46-01: file saved & verified on disk ═══
{
  const buf = Buffer.from("MP3-fake-content-".repeat(50));
  const r = saveAudioBuffer(buf, { baseDir: TMP, ext: ".mp3" });
  report("TEST-46-01 save ok", r.ok === true, r.ok === false ? r.error : "");
  if (r.ok === true) {
    report("TEST-46-01 file exists on disk", fs.existsSync(r.filePath));
    const st = fs.statSync(r.filePath);
    report("TEST-46-01 size matches", st.size === buf.length, `${st.size} vs ${buf.length}`);
    report("TEST-46-01 url is /uploads/audio/...", r.url.startsWith("/uploads/audio/"), r.url);
    report("TEST-46-01 url ends .mp3", r.url.endsWith(".mp3"));
  }
}

// ═══ TEST-46-02: URL accepted by isRealAsset-style validator ═══
{
  const buf = Buffer.from("x".repeat(100));
  const r = saveAudioBuffer(buf, { baseDir: TMP });
  if (r.ok === true) {
    // mirror of pipeline.ts isRealAsset
    const isReal = (s: unknown): boolean => {
      if (typeof s !== "string") return false;
      const t = s.trim();
      if (!t) return false;
      return /^https?:\/\//i.test(t) || t.startsWith("/uploads/");
    };
    report("TEST-46-02 URL accepted by isRealAsset", isReal(r.url));
  } else {
    report("TEST-46-02 URL accepted by isRealAsset", false, "save failed");
  }
}

// ═══ TEST-46-03: empty buffer refused ═══
{
  const r1 = saveAudioBuffer(Buffer.alloc(0));
  const r2 = saveAudioBuffer(null as any);
  report("TEST-46-03 empty buffer refused", r1.ok === false);
  report("TEST-46-03 null refused", r2.ok === false);
}

// ═══ TEST-46-04: write failure → explicit error ═══
{
  // Point at a path that cannot be created (existing file as baseDir).
  const blocker = path.join(TMP, "not-a-dir");
  fs.writeFileSync(blocker, "x");
  const r = saveAudioBuffer(Buffer.from("data"), { baseDir: blocker });
  report("TEST-46-04 write failure → error", r.ok === false);
  if (r.ok === false) {
    report("TEST-46-04 status is 500", r.status === 500, "status=" + r.status);
  }
}

// ═══ TEST-46-05: backwards compat — dataUrl still produced (contract preserved) ═══
{
  // We verify the route source still emits audioDataUrl, and the primary
  // audioUrl is /uploads/... . This is a static check (no HTTP server).
  const src = fs.readFileSync("./src/routes/audio.ts", "utf-8");
  report("TEST-46-05 audioUrl = saved.url", /audioUrl:\s*saved\.url/.test(src));
  report("TEST-46-05 audioDataUrl still returned", /audioDataUrl/.test(src));
  report("TEST-46-05 saveAudioBuffer used", /saveAudioBuffer\(/.test(src));
}

// ═══ TEST-46-06: no paid provider called in tests ═══
{
  // This test file only imports the local audioAssets module — no fetch,
  // no DEEPGRAM endpoint. Assert statically by inspecting this file text.
  const src = fs.readFileSync(new URL(import.meta.url).pathname, "utf-8");
  const hasFetch = /\bfetch\(/.test(src);
  const hasDeepgram = /api\.deepgram\.com/.test(src);
  report("TEST-46-06 no fetch in test", !hasFetch);
  report("TEST-46-06 no deepgram URL in test", !hasDeepgram);
}

// ═══ Filename safety ═══
{
  const n = makeSafeAudioName();
  report("TEST-46-helper name matches pattern", /^audio_\d+_[a-f0-9]{8}\.mp3$/.test(n), n);
  const weird = makeSafeAudioName("..%2f");
  report("TEST-46-helper sanitizes weird ext", /\.mp3$/.test(weird), weird);
}

// cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
