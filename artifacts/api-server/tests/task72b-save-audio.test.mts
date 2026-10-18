/**
 * KAYAN-TASK-72B: verify saveAudioBuffer behavior on the local provider.
 * Uses opts.baseDir to isolate writes to a temp dir — no real uploads touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

process.env.STORAGE_PROVIDER = "local";
delete process.env.R2_ENDPOINT;
delete process.env.R2_BUCKET;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_ACCOUNT_ID;

const { saveAudioBuffer } = await import("../src/lib/audioAssets.ts");

// ── Setup isolated base ──────────────────────────────────────
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "task72b-"));

// ── 1: Valid buffer → ok:true ────────────────────────────────
const buf1 = Buffer.from(crypto.randomBytes(4096)); // 4 KB
const r1 = await saveAudioBuffer(buf1, { baseDir, ext: ".mp3" });
report("TASK72B-01 valid buffer → ok:true", r1.ok === true, r1.ok ? "" : (r1 as any).error);
if (r1.ok) {
  report("TASK72B-02 filePath is a real path", fs.existsSync(r1.filePath));
  report("TASK72B-03 sizeBytes matches buffer length", r1.sizeBytes === buf1.length);
  const disk = fs.readFileSync(r1.filePath);
  report("TASK72B-04 disk content byte-identical", disk.equals(buf1));
  report("TASK72B-05 url under /uploads/audio/", r1.url.startsWith("/uploads/audio/"));
  report("TASK72B-06 url ends with .mp3", r1.url.endsWith(".mp3"));
}

// ── 2: Empty buffer → rejected ───────────────────────────────
const r2 = await saveAudioBuffer(Buffer.alloc(0), { baseDir });
report("TASK72B-07 empty buffer → ok:false", r2.ok === false, r2.ok ? "unexpected ok" : "");
if (!r2.ok) {
  report("TASK72B-08 empty → status 502", r2.status === 502);
  report("TASK72B-09 empty → clear error msg", /empty/i.test(r2.error));
}

// ── 3: Non-Buffer input → rejected ───────────────────────────
const r3 = await saveAudioBuffer("not a buffer" as any, { baseDir });
report("TASK72B-10 non-buffer → ok:false", r3.ok === false);

// ── 4: Two calls → unique filenames ──────────────────────────
const b1 = Buffer.from(crypto.randomBytes(1024));
const b2 = Buffer.from(crypto.randomBytes(1024));
const [s1, s2] = await Promise.all([
  saveAudioBuffer(b1, { baseDir }),
  saveAudioBuffer(b2, { baseDir }),
]);
report("TASK72B-11 both writes ok", s1.ok && s2.ok);
if (s1.ok && s2.ok) {
  report("TASK72B-12 unique filenames", s1.filePath !== s2.filePath);
}

// ── 5: ext sanitization ──────────────────────────────────────
const r5 = await saveAudioBuffer(Buffer.from("test"), { baseDir, ext: ".wav" });
report("TASK72B-13 ext .wav honored", r5.ok && r5.url.endsWith(".wav"));
const r6 = await saveAudioBuffer(Buffer.from("test"), { baseDir, ext: "../../etc/passwd" });
report("TASK72B-14 malicious ext sanitized", r6.ok && !r6.url.includes("..") && /\.(mp3|wav|ogg|aac|flac|m4a)$/.test(r6.url));

// ── 6: On-disk size verified before ok:true ─────────────────
if (r1.ok) {
  const disk = fs.statSync(r1.filePath);
  report("TASK72B-15 disk size verified", disk.size === r1.sizeBytes);
}

// Cleanup
fs.rmSync(baseDir, { recursive: true, force: true });

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
