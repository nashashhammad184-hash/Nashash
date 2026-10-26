import pg from "pg";
const c = new pg.Client({ connectionString: process.env.NEON, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const checks = [
    { tbl: "shots", col: "video_url", w: "video_url LIKE '/uploads/%' OR video_url LIKE 'http%'" },
    { tbl: "render_jobs", col: "output_url", w: "output_url LIKE '/uploads/%' OR output_url LIKE 'http%'" },
    { tbl: "production_pipeline", col: "output", w: "output::text LIKE '%/uploads/%' OR output::text LIKE '%http%'" }
  ];
  for (const x of checks) {
    const r = await c.query(`SELECT count(*)::int as c FROM ${x.tbl} WHERE ${x.w}`);
    console.log(`${x.tbl}: ${r.rows[0].c} rows still local/http`);
  }
  const s = await c.query("SELECT video_url FROM shots WHERE video_url LIKE '/uploads/%' LIMIT 3");
  console.log("SHOTS_LEFTOVER=" + JSON.stringify(s.rows.map(r=>r.video_url)));
  const rj = await c.query("SELECT output_url FROM render_jobs WHERE output_url LIKE '/uploads/%' LIMIT 3");
  console.log("RENDER_LEFTOVER=" + JSON.stringify(rj.rows.map(r=>r.output_url)));
} catch(e) { console.log("ERR=" + e.message); }
finally { try { await c.end(); } catch {} process.exit(0); }
