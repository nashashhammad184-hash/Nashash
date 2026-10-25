import pg from "pg";
import crypto from "crypto";
const c = new pg.Client({ connectionString: process.env.NEON_STAGING_URL, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log("[TEST] " + s);

async function acquire(client, jobId) {
  const r = await client.query(
    `UPDATE gpu_lock SET holder_job_id=$1, holder_kind='LLM_JOB', acquired_at=now(), heartbeat_at=now()
     WHERE id=1 AND (holder_job_id IS NULL OR heartbeat_at < now() - interval '10 seconds')
     RETURNING holder_job_id`, [jobId]
  );
  return r.rowCount === 1;
}

try {
  await c.connect();
  log("connected");
  
  // Reset lock to clean state (safe, only touches gpu_lock)
  await c.query("UPDATE gpu_lock SET holder_job_id=NULL, holder_kind=NULL, acquired_at=NULL, heartbeat_at=NULL WHERE id=1");
  
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  
  // 1. Job A acquires
  const lockA = await acquire(c, jobA);
  log("A_acquired=" + lockA + " (expected: true)");
  
  // 2. Job B tries to acquire (should fail)
  const lockB = await acquire(c, jobB);
  log("B_acquired_when_A_holds=" + lockB + " (expected: false)");
  
  // 3. Release lock (simulate A finishing)
  await c.query("UPDATE gpu_lock SET holder_job_id=NULL WHERE id=1");
  log("released_A");
  
  // 4. Job B tries again (should succeed)
  const lockB2 = await acquire(c, jobB);
  log("B_acquired_after_release=" + lockB2 + " (expected: true)");
  
  // 5. Cleanup
  await c.query("UPDATE gpu_lock SET holder_job_id=NULL, holder_kind=NULL, acquired_at=NULL, heartbeat_at=NULL WHERE id=1");
  log("cleanup_done");
  
  // Final verification
  const state = await c.query("SELECT holder_job_id FROM gpu_lock WHERE id=1");
  log("final_lock_state=" + (state.rows[0].holder_job_id === null ? "NULL_OK" : "NOT_NULL_FAIL"));
  
} catch (e) { log("ERR=" + e.message); }
finally { try { await c.end(); } catch {} process.exit(0); }
