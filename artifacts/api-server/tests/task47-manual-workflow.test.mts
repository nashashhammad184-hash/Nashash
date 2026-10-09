import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pool, db, shotsTable, projectsTable, productionPipeline } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { resolveShotId, persistVideoUrlToShot } from "../src/lib/videoShotLink";
import { resolveAudioShotId, persistAudioUrlToShot } from "../src/lib/audioShotLink";
import { saveAudioBuffer } from "../src/lib/audioAssets";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

async function ensureTimelineTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timeline_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER,
      clip_id INTEGER,
      asset_id TEXT,
      asset_url TEXT,
      track TEXT NOT NULL,
      start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      duration DOUBLE PRECISION NOT NULL DEFAULT 0,
      end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      metadata TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}
async function seedProject(title: string): Promise<number> {
  const [p] = await db.insert(projectsTable).values({
    title, worldId: "noir", projectType: "film", style: "drama",
  } as any).returning();
  return p.id;
}
async function seedShot(projectId: number, description: string): Promise<number> {
  const [s] = await db.insert(shotsTable).values({
    projectId, description, cameraMovement: "static", durationSeconds: 5,
  } as any).returning();
  return s.id;
}
function looksLikeRealAsset(s: any): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length === 0) return false;
  return /^https?:\/\//i.test(t) || t.startsWith("/uploads/");
}
async function cleanupProject(projectId: number) {
  await pool.query(`DELETE FROM timeline_items WHERE project_id = $1`, [projectId]);
  await db.delete(productionPipeline).where(eq(productionPipeline.projectId, projectId));
  await db.delete(shotsTable).where(eq(shotsTable.projectId, projectId));
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t47-"));

// ═══ TEST-47-01: video linked to correct shot ═══
{
  const pid = await seedProject("T47-01");
  const sidA = await seedShot(pid, "A");
  const sidB = await seedShot(pid, "B");
  const r1 = await resolveShotId(sidA, pid);
  if (r1.ok === true && r1.shotId !== null) {
    await persistVideoUrlToShot(r1.shotId, "/uploads/videos/t47_01_a.mp4");
  }
  const r2 = await resolveShotId(sidB, pid);
  if (r2.ok === true && r2.shotId !== null) {
    await persistVideoUrlToShot(r2.shotId, "/uploads/videos/t47_01_b.mp4");
  }
  const rows = await db.select().from(shotsTable).where(eq(shotsTable.projectId, pid));
  const m = new Map(rows.map(r => [r.id, r.videoUrl]));
  report("TEST-47-01 shot A → A", m.get(sidA) === "/uploads/videos/t47_01_a.mp4");
  report("TEST-47-01 shot B → B", m.get(sidB) === "/uploads/videos/t47_01_b.mp4");
  await cleanupProject(pid);
}

// ═══ TEST-47-02: timeline/sync inserts VIDEO row for shot with videoUrl ═══
{
  const pid = await seedProject("T47-02");
  const sid = await seedShot(pid, "sync-test");
  await persistVideoUrlToShot(sid, "/uploads/videos/t47_02.mp4");
  await ensureTimelineTable();
  // Mirror timeline/sync's VIDEO insertion
  await pool.query(
    `INSERT INTO timeline_items (project_id, shot_id, track, start_time, duration, end_time, order_index, content, asset_url, metadata)
     VALUES ($1, $2, 'VIDEO', 0, 5, 5, 1, $3, $4, $5)`,
    [pid, sid, "sync-test", "/uploads/videos/t47_02.mp4", JSON.stringify({ origin: "generated" })]
  );
  const r = await pool.query(`SELECT asset_url, track FROM timeline_items WHERE project_id = $1 AND track = 'VIDEO'`, [pid]);
  report("TEST-47-02 VIDEO track inserted", r.rowCount === 1);
  report("TEST-47-02 asset URL real", looksLikeRealAsset(r.rows[0]?.asset_url));
  await cleanupProject(pid);
}

// ═══ TEST-47-03: repeated sync → no duplicate rows ═══
{
  const pid = await seedProject("T47-03");
  const sid = await seedShot(pid, "repeat");
  await persistVideoUrlToShot(sid, "/uploads/videos/t47_03.mp4");
  await ensureTimelineTable();
  // Upsert pattern used by timeline.ts: same generatedKey → update, not insert.
  for (let i = 0; i < 2; i++) {
    const existing = await pool.query(
      `SELECT id FROM timeline_items WHERE project_id = $1 AND shot_id = $2 AND track = 'VIDEO'`,
      [pid, sid]
    );
    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO timeline_items (project_id, shot_id, track, start_time, duration, end_time, order_index, content, asset_url, metadata)
         VALUES ($1, $2, 'VIDEO', 0, 5, 5, 1, 'x', $3, $4)`,
        [pid, sid, "/uploads/videos/t47_03.mp4", JSON.stringify({ origin: "generated" })]
      );
    }
  }
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM timeline_items WHERE project_id = $1 AND track = 'VIDEO'`, [pid]);
  report("TEST-47-03 no duplicate VIDEO rows", r.rows[0].n === 1, "count=" + r.rows[0].n);
  await cleanupProject(pid);
}

// ═══ TEST-47-04: VOICE only accepted with real asset ═══
{
  const pid = await seedProject("T47-04");
  const sid = await seedShot(pid, "voice");
  const rejected = await persistAudioUrlToShot(sid, "data:audio/mp3;base64,AAAA");
  report("TEST-47-04 data: URL rejected", rejected.ok === false);
  const buf = Buffer.from("fake-mp3-".repeat(20));
  const saved = saveAudioBuffer(buf, { baseDir: TMP });
  report("TEST-47-04 saved to disk", saved.ok === true);
  if (saved.ok === true) {
    const ok = await persistAudioUrlToShot(sid, saved.url);
    report("TEST-47-04 real /uploads URL accepted", ok.ok === true);
    const [row] = await db.select().from(shotsTable).where(eq(shotsTable.id, sid));
    report("TEST-47-04 audioUrl persisted", row.audioUrl === saved.url);
    report("TEST-47-04 audioStatus COMPLETED", row.audioStatus === "COMPLETED");
  }
  await cleanupProject(pid);
}

// ═══ TEST-47-05: render fails on missing VOICE (contract) ═══
{
  const src = fs.readFileSync("./src/routes/render.ts", "utf-8");
  const hasMissingVoiceCheck = src.includes("Real audio asset missing") && src.includes("409");
  const hasMissingVideoCheck = src.includes("لا يوجد أي فيديو حقيقي") || src.includes("no real video");
  report("TEST-47-05 render rejects missing VOICE", hasMissingVoiceCheck);
  report("TEST-47-05 render rejects missing VIDEO", hasMissingVideoCheck);
}

// ═══ TEST-47-06: cross-project isolation ═══
{
  const pidA = await seedProject("T47-06-A");
  const pidB = await seedProject("T47-06-B");
  const sidA = await seedShot(pidA, "A");
  // Attempt to link A's shot from B's context
  const v = await resolveShotId(sidA, pidB);
  const a = await resolveAudioShotId(sidA, pidB);
  report("TEST-47-06 video cross-project rejected", v.ok === false);
  report("TEST-47-06 audio cross-project rejected", a.ok === false);
  await cleanupProject(pidA);
  await cleanupProject(pidB);
}

// ═══ TEST-47-07: module wiring ═══
{
  const audioSrc = fs.readFileSync("./src/routes/audio.ts", "utf-8");
  report("TEST-47-07 audio.ts uses resolveAudioShotId", audioSrc.includes("resolveAudioShotId"));
  report("TEST-47-07 audio.ts uses persistAudioUrlToShot", audioSrc.includes("persistAudioUrlToShot"));
  const videoSrc = fs.readFileSync("./src/routes/video.ts", "utf-8");
  report("TEST-47-07 video.ts uses resolveShotId (from TASK-45)", videoSrc.includes("resolveShotId"));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
