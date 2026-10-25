import pg from "pg";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const c = new pg.Client({ connectionString: process.env.SUPA_URL, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log(`[02C] ${s}`);
const SAVE_FILE = "/tmp/cinema-02c-result.txt";

(async () => {
  try {
    await c.connect();
    log("connected to Supabase");

    // Generate real reference image (512x512 PNG)
    log("generating image...");
    execSync("ffmpeg -y -f lavfi -i color=c=forestgreen:s=512x512:d=1 -frames:v 1 /tmp/cinema-02c-ref.png -loglevel quiet");
    const imageB64 = fs.readFileSync("/tmp/cinema-02c-ref.png").toString("base64");
    log(`image_size=${imageB64.length} chars`);

    // Insert ONE paid job with max_retries=0 and project_id=NULL
    const jobId = crypto.randomUUID();
    const payload = {
      task: "i2v",
      prompt: "A serene forest path at golden hour, cinematic drone shot, 4k",
      referenceImageBase64: imageB64,
      durationSeconds: 5,
      resolution: "480p",
      test_marker: "cinema-02c-test"
    };
    await c.query(
      "INSERT INTO production_pipeline (id, project_id, type, status, payload, max_retries) VALUES ($1, NULL, 'VIDEO_GEN', 'pending', $2::jsonb, 0)",
      [jobId, JSON.stringify(payload)]
    );
    fs.writeFileSync(SAVE_FILE, `job_id=${jobId}\nstarted=${new Date().toISOString()}\n`);
    log(`INSERTED job_id=${jobId} (max_retries=0, project_id=NULL)`);

    // Poll until terminal (10 min max)
    const t0 = Date.now();
    let final = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await c.query("SELECT status, error_message, output, video_url, provider_job_id, retry_count FROM production_pipeline WHERE id=$1", [jobId]);
      const row = res.rows[0];
      if (!row) { log("row_missing"); break; }
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      log(`[${el}s] status=${row.status} retries=${row.retry_count}` + (row.error_message ? ` err=${String(row.error_message).slice(0, 120)}` : ''));
      if (row.status === "completed" || row.status === "failed") {
        final = row;
        break;
      }
    }

    if (final) {
      log(`FINAL_STATUS=${final.status}`);
      log(`FINAL_VIDEO_URL=${final.video_url || "NONE"}`);
      log(`PROVIDER_JOB_ID=${final.provider_job_id || "NONE"}`);
      log(`OUTPUT=${JSON.stringify(final.output || {}).slice(0, 400)}`);
      fs.appendFileSync(SAVE_FILE, `final_status=${final.status}\nfinal_url=${final.video_url || "none"}\n`);
    } else {
      log("NO_TERMINAL_STATE (10min timeout)");
    }
    // NOTE: NOT deleting (per instructions, keep for review)
    log("done");
  } catch(e) { log("ERROR=" + e.message); }
  finally { try { await c.end(); } catch {} process.exit(0); }
})();
