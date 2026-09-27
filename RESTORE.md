# RESTORE.md — Kayan AI Productions Recovery & Change Log

Last updated: 2026-09-27 (KAYAN-FIX-01 → KAYAN-FIX-11)

This document describes every non-trivial change applied to the production
system, so any successor operator can restore or audit the current state.

---

## KAYAN-FIX-01 — Stale-Job Watchdog

- artifacts/api-server/src/lib/services/GpuQueueService.ts
  - Added watchdogStaleRunning(maxAgeMs) — flips gpu_jobs.status from RUNNING
    to FAILED with error='stale_job_no_heartbeat' when the last heartbeat_at
    (or started_at, or created_at) is older than maxAgeMs. Also frees gpu_lock
    if its holder is no longer RUNNING.
- artifacts/api-server/src/queue-worker.ts
  - HEARTBEAT_MS raised 10s -> 60s.
  - Added WATCHDOG_MS=60s, STALE_THRESHOLD_MS=5min, and watchdog() loop
    invoked from loop().

## KAYAN-FIX-02 — I2V Worker Timeout

- Root cause: systemd default TimeoutStartUSec=90s (unit had no explicit
  value) + unattended-upgrades calling needrestart which stopped
  kayangpu-worker mid-cold-load.
- Fix on GPU instance:
  - /etc/systemd/system/kayangpu-worker.service.d/override.conf
    - TimeoutStartSec=1800, Restart=on-failure, RestartSec=10.
  - /etc/needrestart/conf.d/99-kayangpu-skip.conf
    - Excludes kayangpu-worker.service from automatic restart.
- Known performance ceiling (documented, NOT fixed): cold load ~680-800s;
  denoising ~400s/step.

## KAYAN-FIX-03 — Unified Voice Pipeline

- artifacts/api-server/src/routes/voice.ts fully rebuilt.
  - Provider: Deepgram Aura only (DEEPGRAM_API_KEY).
  - edge-tts path removed.
  - PG-backed job via productionEngine.createProductionJob("VOICE_GEN", ...).
  - ffprobe verification (spawn + arg array; no shell string).
  - Path-traversal guard: sanitizeId() regex ^[A-Za-z0-9_-]{1,64}$ on
    characterId, dialogueId, voiceId, shotId.
  - POST /api/voice/generate also updates shots.audio_url / audio_status.
  - GET /api/voice/jobs/:id exposes PG-backed state.
- Shadow file src/services/kayanVoiceWorker.js (LEGACY, not imported) untouched.

## KAYAN-FIX-04 — Continuity Checks

- Status: BLOCKED (no successful I2V job exists yet).
- lib/db/src/schema/continuity_checks.ts still unwired.

## KAYAN-FIX-05 — negative_prompt Documentation

- artifacts/api-server/src/lib/kayanGpuProvider.ts — explicit comment added:
  negative_prompt is accepted by the GPU worker Pydantic model but IGNORED
  silently; never reaches pipe.generate().

## KAYAN-FIX-06 — Canonical Face Reference System

- Migration: ALTER TABLE actors ADD COLUMN canonical_face_image_path TEXT.
- lib/db/src/schema/actors.ts — canonicalFaceImagePath column mapped.
- artifacts/api-server/src/lib/faceIdentity.ts (new):
  - generateCanonicalFaceImage(actorId) — synthetic face from text only,
    enforces assertSyntheticReference, persists to uploads/canonical_faces/,
    updates actors.canonical_face_image_path.
  - readCanonicalFaceBase64(actorId) — helper for I2V.
- artifacts/api-server/src/routes/actors.ts — new
  POST /api/actors/:actorId/canonical-face.
- Status: TIMEOUT — no image produced yet (Google quota=0, FAL locked, GPU T2V
  exceeded test window).

## KAYAN-FIX-07 — Legacy Root Scripts Moved

- 12 files moved from repo root to scripts/legacy/root-scripts/ with a
  README.md warning that they are untrusted and not imported anywhere.
- No files deleted.

## KAYAN-FIX-08 — Rate Limiting & Content Moderation

- artifacts/api-server/package.json — added express-rate-limit.
- artifacts/api-server/src/routes/video.ts
  - generateLimiter: 10 requests / hour / IP on POST /api/video/generate.
  - classifyPrompt(): local deterministic blocklist (real-person likeness,
    deepfake, sexual/minors, graphic violence, hate/illegal-harm). All external
    moderation providers were unavailable.

## KAYAN-FIX-09 — .env.example Reconciled

- .env.example rewritten to match actual process.env usage in
  artifacts/api-server/src.
- Added 19 keys, removed REPLICATE_API_TOKEN.

## KAYAN-FIX-10 — Daily PostgreSQL Backup

- Script: scripts/pg_backup.sh — pg_dump + gzip into /data/backups/,
  retention 7 files.
- Cron (root crontab): 0 3 * * * sudo -u ubuntu
  /home/ubuntu/Nashash/scripts/pg_backup.sh >> /var/log/kayan_pg_backup.log 2>&1

---

## Restore Procedure (database)

    LATEST=$(ls -1t /data/backups/kayan_*.sql.gz | head -1)
    gunzip -c "$LATEST" | psql "postgresql://user:password@localhost:5432/dbname"

## Restore Procedure (GPU worker)

On the GPU instance:

    sudo systemctl daemon-reload
    sudo systemctl restart kayangpu-worker
    systemctl status kayangpu-worker

Verify overrides are still present:
- /etc/systemd/system/kayangpu-worker.service.d/override.conf
- /etc/needrestart/conf.d/99-kayangpu-skip.conf

## Restore Procedure (Nashash)

    cd /home/ubuntu/Nashash
    pnpm install
    pnpm --filter @workspace/api-server build
    pm2 restart nashash-app nashash-queue
