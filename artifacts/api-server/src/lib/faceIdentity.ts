/**
 * KAYAN-FIX-06 — Canonical Face Reference System.
 *
 * Generates a fully synthetic face reference image for an actor from TEXT ONLY.
 * No real-person reference is ever used or downloaded. Legal guard is enforced
 * on the produced asset path before it is persisted.
 *
 * Provider decision (2026-09-27): Google Gemini Image and FAL both exhausted
 * (quota=0 / account locked). The ONLY actually-available image producer is the
 * KayanGPU T2V pipeline (HunyuanVideo-1.5 + LightX2V). We generate a very short
 * T2V clip (17 frames ≈ 1s @ 16fps) and extract the first frame as the canonical
 * still. This is deterministic, cheap, and uses infrastructure already in prod.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, actorsTable } from "@workspace/db";
import { assertSyntheticReference } from "./legalGuard";
import { generateVideoKayanGpu } from "./kayanGpuProvider";
import { logger } from "./logger";

const CANONICAL_DIR = path.resolve(process.cwd(), "uploads", "canonical_faces");
const PROVIDER = "kayangpu-t2v";

export interface CanonicalFaceResult {
  actorId: number;
  imagePath: string;
  imageUrl: string;
  provider: string;
  model: string;
}

function ensureDir(): void {
  if (!fs.existsSync(CANONICAL_DIR)) {
    fs.mkdirSync(CANONICAL_DIR, { recursive: true });
  }
}

function buildPrompt(actor: {
  name: string;
  characterPrompt?: string | null;
  physicalDescription?: string | null;
  characterMasterPrompt?: string | null;
}): string {
  const descriptor =
    (actor.characterPrompt || "").trim() ||
    (actor.characterMasterPrompt || "").trim() ||
    (actor.physicalDescription || "").trim();
  if (!descriptor) {
    throw new Error(
      `actor ${actor.name}: no textual description available (character_prompt / physical_description are empty)`,
    );
  }
  return [
    `Synthetic fictional character — fully AI-generated, no real person.`,
    descriptor,
    "Static head-and-shoulders portrait, neutral studio lighting, plain dark background, looking directly at camera, sharp focus on face, photorealistic.",
  ].join(" ");
}

function extractFirstFrame(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // spawn with array args — no shell string.
    const proc = spawn(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg extract frame exited ${code}: ${err.slice(0, 400)}`));
    });
  });
}

export async function generateCanonicalFaceImage(
  actorId: number,
): Promise<CanonicalFaceResult> {
  ensureDir();

  const rows = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId)).limit(1);
  const actor = rows[0];
  if (!actor) throw new Error(`actor ${actorId} not found`);

  const prompt = buildPrompt({
    name: actor.name,
    characterPrompt: (actor as any).characterPrompt,
    physicalDescription: (actor as any).physicalDescription,
    characterMasterPrompt: (actor as any).characterMasterPrompt,
  });

  // 17 frames = minimum legal by worker ((n-1)%4==0, n in [17,121]).
  // ~1 second at 16fps — fastest T2V the worker accepts.
  const videoResult = await generateVideoKayanGpu({
    prompt,
    task: "t2v",
    numFrames: 17,
    fps: 16,
    steps: 4,
    resolution: "480p",
    aspectRatio: "1:1",
    seed: 42,
  } as any);

  const videoPath = (videoResult as any)?.videoPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`T2V returned no local video for canonical face (path=${videoPath})`);
  }

  const filename = `actor_${actorId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.jpg`;
  const abs = path.join(CANONICAL_DIR, filename);
  await extractFirstFrame(videoPath, abs);

  const st = fs.statSync(abs);
  if (!st.isFile() || st.size < 1024) {
    try { fs.unlinkSync(abs); } catch {}
    throw new Error(`canonical face write failed (size=${st.size})`);
  }

  const relUrl = `/uploads/canonical_faces/${filename}`;

  // KAYAN-LEGAL-00 — enforce synthetic-reference policy on the produced asset.
  assertSyntheticReference(relUrl, { syntheticAcknowledged: true });

  await db
    .update(actorsTable)
    .set({ canonicalFaceImagePath: relUrl } as any)
    .where(eq(actorsTable.id, actorId));

  logger.info(
    { actorId, relUrl, size: st.size, provider: PROVIDER },
    "KAYAN-FIX-06: canonical face generated via T2V",
  );

  return {
    actorId,
    imagePath: abs,
    imageUrl: relUrl,
    provider: PROVIDER,
    model: "hunyuanvideo-1.5-t2v",
  };
}

/** Read the canonical face for an actor as base64, if one is set. */
export async function readCanonicalFaceBase64(
  actorId: number,
): Promise<string | null> {
  const rows = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId)).limit(1);
  const actor = rows[0];
  const rel = (actor as any)?.canonicalFaceImagePath as string | undefined;
  if (!rel) return null;
  const abs = rel.startsWith("/uploads/")
    ? path.resolve(process.cwd(), rel.replace(/^\//, ""))
    : rel;
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs).toString("base64");
}
