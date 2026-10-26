import pg from "pg";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const c = new pg.Client({ connectionString: process.env.SUPA_URL, ssl: { rejectUnauthorized: false } });
const log = (s) => console.log(`[C11 ${new Date().toISOString().slice(11,19)}] ${s}`);
const STATE_FILE = "/tmp/cinema-11-state.txt";

(async () => {
  try {
    await c.connect();
    log("connected_to_supabase");

    log("generating reference image...");
    execSync("ffmpeg -y -f lavfi -i color=c=navy:s=512x512:d=1 -frames:v 1 /tmp/cinema-11-ref.png -loglevel quiet");
    const imageB64 = fs.readFileSync("/tmp/cinema-11-ref.png").toString("base64");
    log(`image_b64_len=${imageB64.length}`);

    const jobId = crypto.randomUUID();
    const payload = {
      task: "i2v",
      prompt: "A calm blue ocean wave at sunrise, cinematic wide shot, 4k",
      referenceImageBase64: imageB64,
      durationSeconds: 5,
      resolution: "480p",
      test_marker: "cinema-11-paid-test"
    };
    await c.query(
      "INSERT INTO production_pipeline (id, project_id, type, status, payload, max_retries) VALUES ($1, NULL, 'VIDEO_GEN', 'pending', $2::jsonb, 0)",
      [jobId, JSON.stringify(payload)]
    );
    log(`INSERTED job_id=${jobId} (max_retries=0, project_id=NULL, 480p, 5s)`);
    fs.writeFileSync(STATE_FILE, `job_id=${jobId}\nstarted=${new Date().toISOString()}\n`);

    const t0 = Date.now();
    let final = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await c.query("SELECT status, error_message, output, video_url, provider_job_id, retry_count FROM production_pipeline WHERE id=$1", [jobId]);
      const row = res.rows[0];
      if (!row) { log("row_missing"); break; }
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      log(`[${el}s] status=${row.status} retries=${row.retry_count}` + (row.provider_job_id ? ` pid=${row.provider_job_id.slice(0,20)}...` : '') + (row.error_message ? ` err=${String(row.error_message).slice(0,100)}` : ''));
      if (row.status === "completed" || row.status === "failed") {
        final = row;
        break;
      }
    }

    if (final) {
      log(`FINAL_STATUS=${final.status}`);
      log(`PROVIDER_JOB_ID=${final.provider_job_id || "NONE"}`);
      log(`VIDEO_URL=${final.video_url || "NONE"}`);
      log(`OUTPUT=${JSON.stringify(final.output || {}).slice(0,500)}`);
      log(`SUBMIT_UNCERTAIN=${/submit_uncertain/i.test(final.error_message || "")}`);
      fs.appendFileSync(STATE_FILE, `final_status=${final.status}\nprovider_job_id=${final.provider_job_id}\nvideo_url=${final.video_url}\noutput=${JSON.stringify(final.output)}\n`);
    } else {
      log("TIMEOUT_NO_TERMINAL_STATE");
    }
    log("done");
  } catch(e) { log("ERROR=" + e.message); }
  finally { try { await c.end(); } catch {} process.exit(0); }
})();
