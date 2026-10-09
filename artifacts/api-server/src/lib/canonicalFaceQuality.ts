/**
 * KAYAN-TASK-04 — Canonical Face Quality Gate.
 *
 * Purpose: reject non-usable references BEFORE they are stored as canonical.
 * A JPG >1024 bytes is NOT a valid canonical face.
 *
 * NOTE ON FACE DETECTION:
 *   Verified in this environment: ffmpeg has no `facedetect` filter and no
 *   OpenCV / dlib / ONNX model is available. True face detection is NOT done
 *   here. Instead, we apply a conservative, measurable quality gate that
 *   reliably rejects: missing, corrupt, zero-dim, tiny, flat, too-dark,
 *   too-bright, extreme-aspect, and structure-less images. This is deliberate
 *   and documented; real face detection is a separate task.
 *
 * NOTE ON METRICS CHOSEN:
 *   - `blurdetect`'s lavfi.blur is not comparable across sources in this build
 *     (sharp synthetic patterns yield ~4-5), so it is NOT used as a threshold.
 *   - `signalstats.YSTD` is not emitted by this ffmpeg build; contrast is
 *     derived from (YHIGH - YLOW) instead.
 *   - structure is derived from sobel edge YAVG.
 *
 * All thresholds are fixed and centralized below.
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pExec = promisify(execFile);

export const QUALITY_THRESHOLDS = Object.freeze({
  MIN_BYTES: 2048,
  MIN_WIDTH: 256,
  MIN_HEIGHT: 256,
  MAX_ASPECT_RATIO: 2.2,
  MIN_BRIGHTNESS: 30,
  MAX_BRIGHTNESS: 225,
  MIN_CONTRAST: 40,     // YHIGH - YLOW
  MIN_EDGE_SCORE: 6.0,  // sobel(gray) YAVG
});

export interface QualityResult {
  pass: boolean;
  reasons: string[];
  metrics: Record<string, number | string | null>;
}

async function probeImage(imagePath: string) {
  const { stdout } = await pExec("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "json",
    imagePath,
  ]);
  const j = JSON.parse(stdout);
  const st = (j?.streams || [])[0] || {};
  return {
    width: Number(st.width || 0),
    height: Number(st.height || 0),
    format: String(st.codec_name || ""),
  };
}

async function signalStats(imagePath: string): Promise<{ yavg: number | null; ylow: number | null; yhigh: number | null }> {
  try {
    const { stdout, stderr } = await pExec("ffmpeg", [
      "-hide_banner", "-i", imagePath,
      "-vf", "signalstats,metadata=print:file=-",
      "-frames:v", "1", "-f", "null", "-",
    ]);
    const s = String(stdout || "") + "\n" + String(stderr || "");
    const pick = (k: string): number | null => {
      const m = s.match(new RegExp(`lavfi\\.signalstats\\.${k}=(-?[\\d.]+)`));
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };
    return { yavg: pick("YAVG"), ylow: pick("YLOW"), yhigh: pick("YHIGH") };
  } catch {
    return { yavg: null, ylow: null, yhigh: null };
  }
}

async function edgeScore(imagePath: string): Promise<number | null> {
  try {
    const { stdout, stderr } = await pExec("ffmpeg", [
      "-hide_banner", "-i", imagePath,
      "-vf", "format=gray,sobel,signalstats,metadata=print:file=-",
      "-frames:v", "1", "-f", "null", "-",
    ]);
    const s = String(stdout || "") + "\n" + String(stderr || "");
    const m = s.match(/lavfi\.signalstats\.YAVG=(-?[\d.]+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function validateCanonicalFaceQuality(imagePath: string): Promise<QualityResult> {
  const reasons: string[] = [];
  const metrics: Record<string, number | string | null> = {};

  if (!imagePath || !fs.existsSync(imagePath)) {
    return { pass: false, reasons: ["file_missing"], metrics };
  }
  const st = fs.statSync(imagePath);
  metrics.bytes = st.size;
  if (!st.isFile() || st.size < QUALITY_THRESHOLDS.MIN_BYTES) {
    reasons.push(`file_too_small(${st.size}<${QUALITY_THRESHOLDS.MIN_BYTES})`);
  }

  let probe;
  try {
    probe = await probeImage(imagePath);
  } catch {
    return { pass: false, reasons: ["decode_failed"], metrics };
  }
  metrics.width = probe.width;
  metrics.height = probe.height;
  metrics.codec = probe.format;
  if (!probe.width || !probe.height) {
    reasons.push("zero_dimensions");
    return { pass: false, reasons, metrics };
  }

  if (probe.width < QUALITY_THRESHOLDS.MIN_WIDTH || probe.height < QUALITY_THRESHOLDS.MIN_HEIGHT) {
    reasons.push(`dimensions_too_small(${probe.width}x${probe.height})`);
  }
  const ar = Math.max(probe.width, probe.height) / Math.min(probe.width, probe.height);
  metrics.aspect_ratio = Number(ar.toFixed(3));
  if (ar > QUALITY_THRESHOLDS.MAX_ASPECT_RATIO) {
    reasons.push(`aspect_ratio_out_of_range(${ar.toFixed(2)})`);
  }

  const ss = await signalStats(imagePath);
  metrics.yavg = ss.yavg;
  metrics.ylow = ss.ylow;
  metrics.yhigh = ss.yhigh;
  if (ss.yavg !== null) {
    if (ss.yavg < QUALITY_THRESHOLDS.MIN_BRIGHTNESS) reasons.push(`too_dark(yavg=${ss.yavg.toFixed(1)})`);
    if (ss.yavg > QUALITY_THRESHOLDS.MAX_BRIGHTNESS) reasons.push(`too_bright(yavg=${ss.yavg.toFixed(1)})`);
  }
  if (ss.ylow !== null && ss.yhigh !== null) {
    const contrast = ss.yhigh - ss.ylow;
    metrics.contrast = contrast;
    if (contrast < QUALITY_THRESHOLDS.MIN_CONTRAST) {
      reasons.push(`low_contrast(${contrast}<${QUALITY_THRESHOLDS.MIN_CONTRAST})`);
    }
  }

  const edges = await edgeScore(imagePath);
  metrics.edge_score = edges;
  if (edges !== null && edges < QUALITY_THRESHOLDS.MIN_EDGE_SCORE) {
    reasons.push(`too_flat(edge=${edges.toFixed(2)}<${QUALITY_THRESHOLDS.MIN_EDGE_SCORE})`);
  }

  return { pass: reasons.length === 0, reasons, metrics };
}
