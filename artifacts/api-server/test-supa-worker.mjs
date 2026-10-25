import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SUPA_URL, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);
try {
  await c.connect();
  log("connected_to_supabase");
  const jobId = `supatest-${Date.now()}`;
  const t0 = Date.now();
  await c.query("INSERT INTO production_pipeline (id, type, status, payload) VALUES ($1, 'VIDEO_GEN', 'pending', $2::jsonb)", [jobId, JSON.stringify({ prompt: "supabase_latency_test", task: "t2v" })]);
  log(`inserted id=${jobId}`);
  let pickup = null, final = null, finalStatus = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await c.query("SELECT status FROM production_pipeline WHERE id=$1", [jobId]);
    if (r.rows.length === 0) { log("row_gone"); break; }
    const st = r.rows[0].status;
    const elapsed = Date.now() - t0;
    if (pickup === null && st !== "pending") { pickup = elapsed; log(`pickup=${elapsed}ms status=${st}`); }
    if (st === "failed" || st === "completed") { final = elapsed; finalStatus = st; break; }
  }
  log(`RESULT pickup=${pickup}ms final=${final}ms status=${finalStatus}`);
  await c.query("DELETE FROM production_pipeline WHERE id=$1", [jobId]);
  log("cleaned_up");
} catch(e) { log("ERR=" + e.message); }
finally { try { await c.end(); } catch {} process.exit(0); }
