/**
 * MockVideoProvider — used only in tests. Generates a tiny real MP4 via
 * ffmpeg's lavfi testsrc. Never touches the network. Never spends money.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  VideoProvider,
  VideoPayload,
  VideoProviderResult,
  ErrorCategory,
} from "./types";

const pExec = promisify(execFile);

const jobs = new Map<string, { payload: VideoPayload; createdAt: number }>();

export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async estimateCost(_payload: VideoPayload): Promise<number> {
    return 0;
  }

  async submit(payload: VideoPayload): Promise<{ providerJobId: string }> {
    const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    jobs.set(id, { payload, createdAt: Date.now() });
    return { providerJobId: id };
  }

  async poll(providerJobId: string): Promise<{
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    error?: string;
  }> {
    const j = jobs.get(providerJobId);
    if (!j) return { status: "failed", error: "unknown job" };
    // Complete after 1s to simulate pipeline
    return Date.now() - j.createdAt > 1000
      ? { status: "completed" }
      : { status: "running" };
  }

  async download(providerJobId: string, outputDir: string): Promise<VideoProviderResult> {
    const j = jobs.get(providerJobId);
    if (!j) throw new Error("mock: unknown job");
    fs.mkdirSync(outputDir, { recursive: true });
    const localPath = path.join(outputDir, `mock_${providerJobId}.mp4`);
    const dur = j.payload.durationSeconds ?? 5;
    await pExec("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `testsrc=duration=${dur}:size=640x640:rate=16`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      localPath,
    ]);
    const { stdout } = await pExec("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-show_entries", "stream=codec_type",
      "-of", "json",
      localPath,
    ]);
    const probe = JSON.parse(stdout);
    return {
      mp4_path: localPath,
      remote_path: `mock://${providerJobId}`,
      duration: Number(probe?.format?.duration ?? 0),
      worker_jid: providerJobId,
      probe,
      provider: "mock",
    };
  }

  classifyError(_err: any): ErrorCategory {
    return "PERMANENT";
  }
}

export const mockProvider = new MockVideoProvider();
