import pg from "pg";
const c = new pg.Client({ connectionString: process.env.NEON_STAGING_URL, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log("[TEST] " + s);
try {
  await c.connect();
  log("connected");
  const ins = await c.query(
    "INSERT INTO gpu_jobs (kind, payload) VALUES ($1, $2::jsonb) RETURNING id, status",
    ["LLM_JOB", JSON.stringify({ test_run: "TASK-AWS-EXIT-16", ts: Date.now() })]
  );
  const jobId = ins.rows[0].id;
  log("inserted_id=" + jobId + " initial_status=" + ins.rows[0].status);
  
  let final = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await c.query("SELECT status, error FROM gpu_jobs WHERE id=$1", [jobId]);
    if (s.rows.length === 0) { log("row_gone"); break; }
    const r = s.rows[0];
    log(`poll_${i} status=${r.status} error=${r.error ? String(r.error).slice(0,120) : "null"}`);
    if (r.status === "FAILED" || r.status === "COMPLETED") { final = r; break; }
  }
  
  if (final) {
    log("FINAL_STATUS=" + final.status);
    log("FINAL_ERROR=" + (final.error || "none"));
  } else {
    log("no_terminal_state_reached");
  }
  
  const del = await c.query("DELETE FROM gpu_jobs WHERE id=$1 RETURNING id", [jobId]);
  log("deleted_count=" + del.rowCount);
  const verify = await c.query("SELECT count(*)::int as c FROM gpu_jobs WHERE id=$1", [jobId]);
  log("verify_deleted=" + (verify.rows[0].c === 0 ? "OK" : "FAIL"));
  const total = await c.query("SELECT count(*)::int as c FROM gpu_jobs");
  log("table_total_after=" + total.rows[0].c);
} catch (e) { log("ERR=" + e.message); }
finally { try { await c.end(); } catch {} process.exit(0); }
