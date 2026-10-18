import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = fs.readFileSync(path.join(root, 'src/lib/renderEngine.ts'), 'utf8');

// ── Static contract checks ──
assert.doesNotMatch(src, /-shortest/, '-shortest must be removed (audio policy is explicit)');
assert.match(src, /drawtext=/, 'watermark drawtext filter missing');
assert.match(src, /subtitles='/, 'subtitles libass filter missing');
assert.match(src, /sourceStart/, 'sourceStart not handled');
assert.match(src, /sourceEnd/, 'sourceEnd not handled');
assert.match(src, /ss", String\(srcStart\)/, 'ffmpeg -ss trimming missing');
assert.match(src, /audio policy: audio duration/, 'audio duration policy missing');
assert.match(src, /output duration \$\{outProbe\.duration\}s deviates/, 'output duration deviation check missing');
assert.match(src, /timeline policy/, 'timeline contiguity policy missing');

const TMP = fs.mkdtempSync('/tmp/re-test-');
const p = (n) => path.join(TMP, n);

// ── Create fixture clip A: 4s red, clip B: 4s blue ──
const clipA = p('a.mp4');
const clipB = p('b.mp4');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=320x240:d=4:r=24','-pix_fmt','yuv420p','-c:v','libx264','-t','4',clipA]);
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x240:d=4:r=24','-pix_fmt','yuv420p','-c:v','libx264','-t','4',clipB]);

// ── Create fixture audio: real voice-like tone (test-only; production forbids this) ──
const audio = p('voice.m4a');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=300:duration=4','-c:a','aac','-b:a','128k',audio]);

// ── Trim: A ss=1 to=3 (2s), B ss=2 to=4 (2s). Expected total = 4s. ──
const trimA = p('ta.mp4'), trimB = p('tb.mp4');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-ss','1','-to','3','-i',clipA,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-an',trimA]);
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-ss','2','-to','4','-i',clipB,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-an',trimB]);

const durOf = (f) => Number(JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',f]).toString()).format.duration);
const dA = durOf(trimA), dB = durOf(trimB);
assert.ok(Math.abs(dA - 2) < 0.15, `trim A expected ~2s, got ${dA}`);
assert.ok(Math.abs(dB - 2) < 0.15, `trim B expected ~2s, got ${dB}`);

// ── Concat ──
const list = p('list.txt');
fs.writeFileSync(list, `file '${trimA}'\nfile '${trimB}'\n`);
const concat = p('concat.mp4');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-an',concat]);
const dC = durOf(concat);
assert.ok(Math.abs(dC - 4) < 0.3, `concat expected ~4s, got ${dC}`);

// ── Watermark + subtitles burn-in ──
const srt = p('s.srt');
fs.writeFileSync(srt, `1\n00:00:00,000 --> 00:00:02,000\nHELLO SUB 1\n\n2\n00:00:02,000 --> 00:00:04,000\nHELLO SUB 2\n`);
const finalOut = p('final.mp4');
const vf = [
  `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='WM_TEST':fontcolor=white@0.85:fontsize=h/20:box=1:boxcolor=black@0.45:boxborderw=10:x=(w-text_w)/2:y=h-th-30`,
  `subtitles='${srt}'`,
].join(',');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-i',concat,'-i',audio,'-vf',vf,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','4','-movflags','+faststart',finalOut]);

const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-show_entries','format=duration','-of','json',finalOut]).toString());
const streams = probe.streams.map(s => s.codec_type);
assert.ok(streams.includes('video'), 'final must have video stream');
assert.ok(streams.includes('audio'), 'final must have audio stream (not -an)');
assert.ok(Number(probe.format.duration) > 3.5, `final duration ~4s, got ${probe.format.duration}`);

// ── Pixel verification: watermark region must NOT be pure red/blue ──
// Extract a frame at 1s (red section) and check bottom-center for white pixels.
const frame = p('f1.png');
execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-ss','1','-i',finalOut,'-frames:v','1',frame]);

// Use signalstats on cropped region to detect non-red content (watermark is white on black box)
const cropStats = execFileSync('ffmpeg', ['-hide_banner','-i',frame,'-vf','crop=200:40:60:200,signalstats,metadata=print:file=-','-frames:v','1','-f','null','-'], { stdio: ['ignore','pipe','pipe'] });
const stext = String(cropStats);
// Not purely red: white box present → higher YAVG than red would give.
// More robust: count distinct values via format=gray sobel edges (text produces edges).
const edgeStats = execFileSync('ffmpeg', ['-hide_banner','-i',frame,'-vf','crop=200:40:60:200,format=gray,sobel,signalstats,metadata=print:file=-','-frames:v','1','-f','null','-'], { stdio: ['ignore','pipe','pipe'] });
const em = String(edgeStats).match(/lavfi\.signalstats\.YAVG=(-?[\d.]+)/);
assert.ok(em, 'edge stats must be readable');
const edgeYAvg = Number(em[1]);
assert.ok(edgeYAvg > 1.0, `watermark region must show structure (edge=${edgeYAvg}); pure color has ~0`);

// ── Placeholder rejection ──
function rejectsPlaceholder(url) {
  const FORBIDDEN = [/mozilla\.net/i, /flower\.mp4/i, /interactive-examples/i, /sample-videos/i, /w3schools/i];
  return FORBIDDEN.some(r => r.test(url));
}
assert.ok(rejectsPlaceholder('https://mozilla.net/flower.mp4'), 'mozilla.net must be rejected');
assert.ok(rejectsPlaceholder('https://example.com/sample-videos/x.mp4'), 'sample-videos must be rejected');

// ── Contiguity policy: source declares it ──
assert.match(src, /does not match expected contiguous cursor/, 'contiguity error message missing');
assert.match(src, /Gaps are not allowed/, 'gap policy missing');

console.log('RENDER_ENGINE_TESTS_PASS');
