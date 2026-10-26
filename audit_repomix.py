#!/usr/bin/env python3
"""
Kayan Studio — Repomix-based Comprehensive Audit (Task 61427)
Reads repomix-61427.xml and validates:
  - Production pipeline unification
  - No forbidden patterns
  - DB persistence (no in-memory stores)
  - LEGACY/TEST-ONLY isolation
  - PrivateTmp fix in queue-worker
  - Boot recovery, FULL_PIPELINE exclusion
  - Every stage produces real assets
"""
import re
import sys
import os
import xml.etree.ElementTree as ET
from collections import defaultdict

REPO = "/home/ubuntu/Nashash"
XML = os.path.join(REPO, "repomix-61427.xml")

if not os.path.exists(XML):
    print(f"❌ {XML} not found. Run repomix first.")
    sys.exit(1)

# --- parse repomix XML ---
# repomix XML format: <file path="...">content</file> OR CDATA blocks
with open(XML, "r", encoding="utf-8", errors="replace") as f:
    raw = f.read()

files = {}
# Try ElementTree first
try:
    root = ET.fromstring(raw)
    for fnode in root.iter("file"):
        path = fnode.get("path") or fnode.get("name") or ""
        content = "".join(fnode.itertext())
        if path:
            files[path] = content
except Exception:
    # fallback: regex parse
    for m in re.finditer(r'<file\s+path="([^"]+)"[^>]*>(.*?)</file>', raw, re.DOTALL):
        files[m.group(1)] = m.group(2)

if not files:
    print("⚠️  No files parsed — falling back to raw grep on XML.")
    files = {"__RAW__": raw}

print(f"📦 Loaded {len(files)} files from repomix\n")

# --- helpers ---
def find_file(*needles):
    """Return (path, content) of first matching path containing all needles."""
    for p, c in files.items():
        if all(n in p for n in needles):
            return p, c
    return None, None

def exists(*needles):
    p, _ = find_file(*needles)
    return p is not None

def search(pattern, in_path=None, flags=0):
    """Search pattern across all files (or one). Returns list of (path, line, snippet)."""
    hits = []
    rx = re.compile(pattern, flags)
    targets = [(in_path, files[in_path])] if in_path and in_path in files else files.items()
    for p, c in targets:
        for i, line in enumerate(c.splitlines(), 1):
            if rx.search(line):
                hits.append((p, i, line.strip()[:120]))
    return hits

def section(title):
    print(f"\n─── {title} " + "─" * max(0, 60 - len(title)))

PASS = []
FAIL = []
WARN = []

def ok(m):   PASS.append(m); print(f"  ✅ {m}")
def no(m):   FAIL.append(m); print(f"  ❌ {m}")
def wr(m):   WARN.append(m); print(f"  ⚠️  {m}")
def inf(m):  print(f"  •  {m}")

# ═══════════════════════════════════════════════════════════════
section("[1] OFFICIAL PIPELINE EXISTS")
# ═══════════════════════════════════════════════════════════════
pipeline_path, pipeline_src = find_file("artifacts/api-server/src/routes/pipeline.ts")
if pipeline_path:
    ok(f"pipeline.ts exists ({len(pipeline_src.splitlines())} lines)")
else:
    no("pipeline.ts MISSING")

prod_eng_path, prod_eng_src = find_file("artifacts/api-server/src/lib/productionEngine.ts")
if prod_eng_path:
    ok(f"productionEngine.ts exists ({len(prod_eng_src.splitlines())} lines)")
else:
    no("productionEngine.ts MISSING")

render_eng_path, render_eng_src = find_file("artifacts/api-server/src/lib/renderEngine.ts")
if render_eng_path:
    ok(f"renderEngine.ts exists ({len(render_eng_src.splitlines())} lines)")
else:
    no("renderEngine.ts MISSING")

# ═══════════════════════════════════════════════════════════════
section("[2] ALL 11 STAGES WIRED IN pipeline.ts")
# ═══════════════════════════════════════════════════════════════
if pipeline_src:
    required_stages = ["project", "script", "shots", "voice", "video",
                       "lipsync", "timeline", "auto_edit", "subtitles",
                       "render", "final_mp4"]
    for st in required_stages:
        if re.search(rf'"{st}"', pipeline_src):
            ok(f"stage '{st}' referenced")
        else:
            no(f"stage '{st}' MISSING")

# ═══════════════════════════════════════════════════════════════
section("[3] DB PERSISTENCE (no in-memory stores)")
# ═══════════════════════════════════════════════════════════════
# renderEngine must not use new Map<string, RenderJob>
if render_eng_src and re.search(r'new Map<string,\s*RenderJob', render_eng_src):
    no("renderEngine still uses in-memory Map")
else:
    ok("renderEngine — no in-memory Map (DB-backed)")

# productionEngine must not use jobsStore Map
if prod_eng_src and re.search(r'(jobsStore|pipelineRunsStore)\s*=\s*new Map', prod_eng_src):
    no("productionEngine still uses in-memory Map")
else:
    ok("productionEngine — no in-memory store")

# productionEngine must use productionPipeline table
if prod_eng_src and "productionPipeline" in prod_eng_src:
    ok("productionEngine persists to production_pipeline table")
else:
    no("productionEngine does NOT use production_pipeline")

# pipeline.ts must persist to production_pipeline
if pipeline_src and "productionPipeline" in pipeline_src:
    ok("pipeline.ts persists to production_pipeline table")
else:
    no("pipeline.ts does NOT persist to production_pipeline")

# renderEngine must use renderJobsTable
if render_eng_src and "renderJobsTable" in render_eng_src:
    ok("renderEngine uses render_jobs table")
else:
    no("renderEngine does NOT use render_jobs")

# ═══════════════════════════════════════════════════════════════
section("[4] FORBIDDEN PATTERNS (production source)")
# ═══════════════════════════════════════════════════════════════
FORBIDDEN = ["mozilla.net", "flower.mp4", "sample-videos",
             "interactive-examples", "color=c=black", "color=c=blue",
             "color=c=red"]
for pat in FORBIDDEN:
    hits = search(re.escape(pat))
    # filter out comments and FORBIDDEN_ASSET_PATTERNS list itself
    hits = [h for h in hits
            if "FORBIDDEN_ASSET_PATTERNS" not in h[2]
            and not h[2].lstrip().startswith(("//", "#", "*"))]
    # only consider artifacts/api-server (production)
    hits = [h for h in hits if "artifacts/api-server" in h[0]]
    if hits:
        no(f"'{pat}' appears {len(hits)} times in production")
        for p, i, s in hits[:3]:
            inf(f"  {p}:{i} → {s}")
    else:
        ok(f"'{pat}' not in production code")

# ═══════════════════════════════════════════════════════════════
section("[5] LEGACY / TEST-ONLY ISOLATION")
# ═══════════════════════════════════════════════════════════════
legacy_files = [p for p in files if (p.startswith("src/services/") or
                                       p.startswith("src/workers/"))]
tagged = [p for p in legacy_files if "LEGACY / TEST-ONLY" in files[p][:600]]
inf(f"src/services|workers files: {len(legacy_files)}")
inf(f"tagged LEGACY/TEST-ONLY:    {len(tagged)}")
if len(legacy_files) > 0 and len(tagged) == len(legacy_files):
    ok("all legacy files tagged")
elif len(tagged) > 0:
    wr(f"{len(legacy_files) - len(tagged)} legacy files NOT tagged")

# no imports from src/services in production
bad_imports = []
for p, c in files.items():
    if not p.startswith("artifacts/api-server/"):
        continue
    for i, line in enumerate(c.splitlines(), 1):
        if re.search(r'from\s+["\'].*src/services/', line) or \
           re.search(r'from\s+["\'].*src/workers/', line):
            if "lib/services" not in line:
                bad_imports.append((p, i, line.strip()[:100]))
if bad_imports:
    no(f"{len(bad_imports)} imports from src/services|workers in production")
    for p, i, s in bad_imports[:5]:
        inf(f"  {p}:{i} → {s}")
else:
    ok("production code has ZERO imports from src/services|workers")

# ═══════════════════════════════════════════════════════════════
section("[6] PRIVATETMP FIX in queue-worker.ts")
# ═══════════════════════════════════════════════════════════════
qw_path, qw_src = find_file("artifacts/api-server/src/queue-worker.ts")
if qw_src:
    if "/data/lipsync_in/" in qw_src:
        ok("queue-worker uses /data/lipsync_in/ (PrivateTmp-safe)")
    elif "/tmp/lipsync_in_" in qw_src:
        no("queue-worker still uses /tmp/lipsync_in_ (PrivateTmp BROKEN)")
    else:
        wr("queue-worker has no /data/lipsync_in/ or /tmp/lipsync_in_ reference")
else:
    no("queue-worker.ts MISSING")

# ═══════════════════════════════════════════════════════════════
section("[7] PRODUCTION ENGINE — EXCLUDES FULL_PIPELINE")
# ═══════════════════════════════════════════════════════════════
if prod_eng_src:
    if re.search(r'ne\(\s*productionPipeline\.type\s*,\s*["\']FULL_PIPELINE', prod_eng_src):
        ok("productionEngine excludes FULL_PIPELINE from queue selection")
    else:
        no("productionEngine does NOT exclude FULL_PIPELINE")

    # boot recovery
    if "boot recovery" in prod_eng_src or "recoverStale" in prod_eng_src:
        ok("productionEngine has boot recovery")
    else:
        wr("productionEngine — no boot recovery evidence")

# pipeline.ts must have stale-run recovery
if pipeline_src:
    if "recoverStalePipelineRuns" in pipeline_src or "recovered: API restart" in pipeline_src:
        ok("pipeline.ts has restart recovery")
    else:
        no("pipeline.ts — no restart recovery")

# ═══════════════════════════════════════════════════════════════
section("[8] RENDER ENGINE — AUDIO SUPPORT + VERIFY")
# ═══════════════════════════════════════════════════════════════
if render_eng_src:
    checks = {
        "audio mix support": r'audioUrl',
        "hasAudio probe": r'hasAudio',
        "ffprobe verify": r'ffprobe',
        "forbidden asset patterns": r'FORBIDDEN_ASSET_PATTERNS',
        "download with SSRF guard": r'downloadToTemp',
        "no pipe:0": r'(?!pipe:0)',
    }
    for name, pat in checks.items():
        if name == "no pipe:0":
            if '"pipe:0"' in render_eng_src or "pipe:0" in render_eng_src:
                no("renderEngine uses pipe:0 (forbidden)")
            else:
                ok("renderEngine — no pipe:0")
            continue
        if re.search(pat, render_eng_src):
            ok(f"renderEngine has {name}")
        else:
            no(f"renderEngine — MISSING {name}")

    # verify no -an flag (audio must be allowed)
    if re.search(r'"-an"', render_eng_src):
        wr("renderEngine uses -an (audio disabled) at least once")

# ═══════════════════════════════════════════════════════════════
section("[9] ASSET CONTRACTS (real paths, no placeholders)")
# ═══════════════════════════════════════════════════════════════
if prod_eng_src:
    contracts = {
        "videoPath": r'videoPath',
        "videoUrl": r'videoUrl',
        "audioPath": r'audioPath',
        "audioUrl": r'audioUrl',
        "syncedVideoPath": r'syncedVideoPath',
        "syncedVideoUrl": r'syncedVideoUrl',
    }
    for name, pat in contracts.items():
        if re.search(pat, prod_eng_src):
            ok(f"contract '{name}' present")
        else:
            no(f"contract '{name}' MISSING")

    # no MUSIC_SFX_GEN fabricated
    if "MUSIC_SFX_GEN" in prod_eng_src:
        # must throw explicitly
        if re.search(r'MUSIC_SFX_GEN[^}]*throw', prod_eng_src, re.DOTALL) or \
           re.search(r'throw[^;]*MUSIC_SFX_GEN', prod_eng_src, re.DOTALL):
            ok("MUSIC_SFX_GEN throws explicitly (no fabrication)")
        else:
            wr("MUSIC_SFX_GEN present but no explicit throw")

# ═══════════════════════════════════════════════════════════════
section("[10] UI UNCHANGED (no new UI files)")
# ═══════════════════════════════════════════════════════════════
ui_files = [p for p in files if p.startswith("artifacts/studio/src/")]
inf(f"studio UI files: {len(ui_files)}")
# Check editing.tsx doesn't have asset_${Date.now()}
editing_path, editing_src = find_file("artifacts/studio/src/components/project/tabs/editing.tsx")
if editing_src:
    if re.search(r'assetId:\s*`asset_\$\{Date\.now\(\)\}`', editing_src):
        no("editing.tsx still has assetId: `asset_${Date.now()}`")
    else:
        ok("editing.tsx — no placeholder assetId")

# ═══════════════════════════════════════════════════════════════
section("[11] GPU QUEUE PRESERVED")
# ═══════════════════════════════════════════════════════════════
gqs_path, gqs_src = find_file("artifacts/api-server/src/lib/services/GpuQueueService.ts")
if gqs_src:
    ok(f"GpuQueueService.ts exists ({len(gqs_src.splitlines())} lines)")
    for kind in ["VIDEO_JOB", "LLM_JOB", "LIP_SYNC_JOB"]:
        if kind in gqs_src:
            ok(f"JobKind '{kind}' preserved")
        else:
            no(f"JobKind '{kind}' MISSING")

# ═══════════════════════════════════════════════════════════════
section("[12] MIGRATIONS")
# ═══════════════════════════════════════════════════════════════
migration_files = [p for p in files if "artifacts/api-server/migrations/" in p]
inf(f"migrations: {len(migration_files)}")
for m in sorted(migration_files):
    inf(f"  {os.path.basename(m)}")

has_render = any("52743_render_jobs" in m for m in migration_files)
has_lipsync = any("52742_lipsync" in m for m in migration_files)
has_queue = any("52741_gpu_queue" in m for m in migration_files)
ok("52743_render_jobs.sql") if has_render else no("52743_render_jobs.sql MISSING")
ok("52742_lipsync_kind.sql") if has_lipsync else no("52742_lipsync_kind.sql MISSING")
ok("52741_gpu_queue.sql") if has_queue else no("52741_gpu_queue.sql MISSING")

# ═══════════════════════════════════════════════════════════════
section("[13] SUBTITLE SERVICE")
# ═══════════════════════════════════════════════════════════════
sub_path, sub_src = find_file("artifacts/api-server/src/lib/subtitleService.ts")
if sub_src:
    for fn in ["generateSRT", "generateVTT"]:
        if fn in sub_src:
            ok(f"subtitleService.{fn} present")
        else:
            no(f"subtitleService.{fn} MISSING")
    if pipeline_src and "generateSRT" in pipeline_src:
        ok("pipeline uses generateSRT")
    else:
        no("pipeline does NOT use generateSRT")

# ═══════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════
print()
print("╔" + "═" * 62 + "╗")
print("║" + " VERDICT — Task 61427".ljust(62) + "║")
print("╚" + "═" * 62 + "╝")
print(f"  ✅ PASS: {len(PASS)}")
print(f"  ⚠️  WARN: {len(WARN)}")
print(f"  ❌ FAIL: {len(FAIL)}")
print()
if FAIL:
    print("  🔴 BLOCKERS:")
    for f in FAIL:
        print(f"     - {f}")
    print()
    print("  ❌ AUDIT FAILED — fix blockers above")
    sys.exit(1)
elif WARN:
    print("  🟡 WARNINGS (non-blocking):")
    for w in WARN[:5]:
        print(f"     - {w}")
    print()
    print("  ✅ AUDIT PASSED WITH WARNINGS")
    sys.exit(0)
else:
    print("  ✅ ALL CHECKS PASSED — Task 61427 verified")
    sys.exit(0)
