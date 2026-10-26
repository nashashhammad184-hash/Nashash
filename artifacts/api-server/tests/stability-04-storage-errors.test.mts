/**
 * KAYAN-STABILITY-04: behavioral for persist failure + sanitized 500 responses.
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── T1: persistRenderFile throws → job marked FAILED (not COMPLETED) ─
{
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/renderEngine.ts"), "utf8");
  // Find the persist block
  const hasThrow = /throw new Error\(`render storage persist failed/.test(src);
  report("T1-a renderEngine throws on persist failure", hasThrow);
  // Verify setJobStatus COMPLETED is AFTER the throw (not before)
  const throwIdx = src.indexOf("render storage persist failed");
  const completedIdx = src.indexOf('setJobStatus(jobId, "COMPLETED"');
  report("T1-b COMPLETED status is after persist throw", completedIdx > throwIdx && throwIdx >= 0, `throw@${throwIdx} completed@${completedIdx}`);
  // Verify catch block sets FAILED
  const failedIdx = src.indexOf('setJobStatus(jobId, "FAILED"');
  report("T1-c catch sets FAILED status", failedIdx > 0);
}

// ─── T2: 500 responses don't include err.message or error.message ────
{
  const files = ["timeline.ts", "clips.ts", "shots.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/" + f), "utf8");
    // Any `res.status(500).json({...err.message...})` = leak
    const re = /res\.status\(500\)[\s\S]{0,300}?\}/g;
    const matches = src.match(re) || [];
    let leaked = 0;
    for (const m of matches) {
      if (/err\.message|error\.message/.test(m)) leaked++;
    }
    report(`T2-${f} no message leak in 500 bodies`, leaked === 0, `leaked=${leaked}/${matches.length}`);
  }
}

// ─── T3: server-side log preserves detail ────────────────────────────
{
  const files = ["timeline.ts", "clips.ts", "shots.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/" + f), "utf8");
    const logs = (src.match(/console\.error\([^)]*internal error/g) || []).length;
    report(`T3-${f} diagnostic logged server-side`, logs >= 1, `logs=${logs}`);
  }
}

// ─── T4: rate limit returns 429-style structured body ────────────────
{
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/renderMerge.ts"), "utf8");
  report("T4-a rate limiter defines message", /message:\s*\{[^}]*error:\s*"TOO_MANY_REQUESTS"/.test(src));
  report("T4-b rate limit response has code", /code:\s*"RENDER_RATE_LIMITED"/.test(src));
}

// ─── T5: storage.ts doesn't log secrets ──────────────────────────────
{
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/storage.ts"), "utf8");
  const leaks = /console\.(log|error|warn)\([^)]*(SERVICE_ROLE_KEY|SUPABASE_URL\s*\+|signedUrl\b)/.test(src);
  report("T5 storage.ts no secret logging", !leaks);
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
