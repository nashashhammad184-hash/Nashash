import pg from 'pg';
const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function listFiles(prefix = '') {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/nashash-uploads`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000 })
  });
  const items = await res.json();
  if (!Array.isArray(items)) { console.log('API_ERR:', JSON.stringify(items).slice(0,200)); return new Set(); }
  const files = new Set();
  for (const item of items) {
    if (item.metadata === null) {
      const sub = await listFiles(prefix ? `${prefix}/${item.name}` : item.name);
      sub.forEach(f => files.add(f));
    } else { files.add(prefix ? `${prefix}/${item.name}` : item.name); }
  }
  return files;
}
(async () => {
  try {
    await c.connect();
    const sbFiles = await listFiles();
    console.log(`Found ${sbFiles.size} files.`);
    const convert = (url) => {
      if (!url || !url.startsWith('/uploads/')) return null;
      const key = url.replace('/uploads/', '');
      return sbFiles.has(key) ? `/api/storage/supabase/${key}` : null;
    };
    let updated = 0;
    const shots = await c.query("SELECT id, video_url FROM shots WHERE video_url LIKE '/uploads/%'");
    for (const r of shots.rows) { const nu = convert(r.video_url); if (nu) { await c.query("UPDATE shots SET video_url=$1 WHERE id=$2", [nu, r.id]); updated++; } }
    const renders = await c.query("SELECT id, output_url FROM render_jobs WHERE output_url LIKE '/uploads/%'");
    for (const r of renders.rows) { const nu = convert(r.output_url); if (nu) { await c.query("UPDATE render_jobs SET output_url=$1 WHERE id=$2", [nu, r.id]); updated++; } }
    const pipeline = await c.query("SELECT id, output FROM production_pipeline WHERE output::text LIKE '%/uploads/%'");
    for (const r of pipeline.rows) {
      let out = r.output || {}; let changed = false;
      if (out.audioUrl) { const nu = convert(out.audioUrl); if (nu) { out.audioUrl = nu; changed = true; } }
      if (out.videoUrl) { const nu = convert(out.videoUrl); if (nu) { out.videoUrl = nu; changed = true; } }
      if (changed) { await c.query("UPDATE production_pipeline SET output=$1 WHERE id=$2", [out, r.id]); updated++; }
    }
    console.log(`Updated ${updated} records.`);
  } catch (e) { console.log("ERROR:", e.message); }
  finally { try { await c.end(); } catch {} process.exit(0); }
})();
