import pg from "pg";
const c = new pg.Client({ connectionString: process.env.NEON, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);
try {
  await c.connect();
  log("Starting scale-to-zero test: 3 queries spaced 3 minutes apart");
  log("If CU-hours in Neon Console drops between queries, scale-to-zero works");
  for (let i = 0; i < 3; i++) {
    await c.query("SELECT 1");
    log(`Query ${i+1}/3 done`);
    if (i < 2) {
      log("Sleeping 180s (3 min)...");
      await new Promise(r => setTimeout(r, 180000));
    }
  }
  log("DONE");
} catch(e) { log("ERR=" + e.message); }
finally { try { await c.end(); } catch {} process.exit(0); }
