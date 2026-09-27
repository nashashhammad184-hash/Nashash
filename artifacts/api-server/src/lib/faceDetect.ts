/**
 * faceDetect.ts — Lightweight face presence check (no GPU).
 *
 * Uses OpenCV Haar cascade via a tiny Python helper running in a dedicated
 * venv (.venvs/face/bin/python). Runs on Nashash only.
 *
 * Purpose: decide whether a KayanGPU-produced video is a candidate for
 * lip sync BEFORE we spend GPU time on Wav2Lip. If no face is present,
 * Lip Sync is semantically skipped (not failed).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const pExec = promisify(execFile);

export interface FaceDetectResult {
  hasFace: boolean;
  faceFrames: number;
  sampledFrames: number;
  confidence: number;
  reason?: string;
}

const PY_HELPER = path.resolve(process.cwd(), "scripts", "face_detect.py");
const PY_BIN = process.env.KAYAN_FACE_PYTHON
  || path.resolve(process.cwd(), ".venvs", "face", "bin", "python");

export async function detectFacesInVideo(videoPath: string, sampleCount = 10): Promise<FaceDetectResult> {
  if (!fs.existsSync(videoPath)) {
    return { hasFace: false, faceFrames: 0, sampledFrames: 0, confidence: 0, reason: "file_missing" };
  }
  if (!fs.existsSync(PY_HELPER)) {
    return { hasFace: false, faceFrames: 0, sampledFrames: 0, confidence: 0, reason: "helper_missing" };
  }
  if (!fs.existsSync(PY_BIN)) {
    return { hasFace: false, faceFrames: 0, sampledFrames: 0, confidence: 0, reason: "python_missing" };
  }

  try {
    const { stdout } = await pExec(PY_BIN, [PY_HELPER, videoPath, String(sampleCount)], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const j = JSON.parse(stdout.trim());
    return {
      hasFace: !!j.has_face,
      faceFrames: Number(j.face_frames) || 0,
      sampledFrames: Number(j.sampled_frames) || 0,
      confidence: Number(j.confidence) || 0,
      reason: j.reason,
    };
  } catch (e: any) {
    return {
      hasFace: false,
      faceFrames: 0,
      sampledFrames: 0,
      confidence: 0,
      reason: "helper_error: " + (e?.message || String(e)).slice(0, 120),
    };
  }
}
