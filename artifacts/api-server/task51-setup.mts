import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const TS = Date.now();
const title = "TASK51_E2E_" + TS;

// 1. Create test project
const proj = await c.query(
  "INSERT INTO projects (title, world_id, project_type, style, status) VALUES ($1, $2, 'film', 'drama', 'development') RETURNING id",
  [title, "noir"]
);
const projectId = proj.rows[0].id;
console.log("PROJECT_ID=" + projectId);

// 2. Create 3 shots linked to TASK-42 MP4s
const shots = [
  { desc: "TASK51 CLOSE-UP test", dialogue: "TASK51 dialogue one", url: "/uploads/videos/ws_88caf3d047c440d5bd46e3649e223d11.mp4" },
  { desc: "TASK51 MEDIUM test",   dialogue: "TASK51 dialogue two", url: "/uploads/videos/ws_f1f0c596927c4ad9bbb29a1af19fb24b.mp4" },
  { desc: "TASK51 WIDE test",     dialogue: null,                  url: "/uploads/videos/ws_3cac15f2a77d45c1aaccf04e16dee173.mp4" },
];
const shotIds: number[] = [];
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  const r = await c.query(
    "INSERT INTO shots (project_id, description, camera_movement, duration_seconds, dialogue, video_url, audio_status, scene_number) VALUES ($1, $2, 'static', 5, $3, $4, 'QUEUED', $5) RETURNING id",
    [projectId, s.desc, s.dialogue, s.url, String(i + 1)]
  );
  shotIds.push(r.rows[0].id);
}
console.log("SHOT_IDS=" + shotIds.join(","));

// 3. Verify
const verify = await c.query("SELECT id, video_url, dialogue FROM shots WHERE project_id = $1 ORDER BY id", [projectId]);
for (const row of verify.rows) console.log("VERIFY", JSON.stringify(row));

await c.end();
