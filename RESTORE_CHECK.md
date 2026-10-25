# RESTORE_CHECK.md — Restore Verification (KAYAN-GUARD-02)

**Date:** 2026-10-25
**Verified by:** KAYAN-GUARD-02 automated drill
**Source commit:** `893a1dd9f6e87578b6cef6fd46e8dd35af2a9faf` (`cinema-dev-01`)

## Method
Fresh clone into `/home/ubuntu/restore-test` (not the production working tree), then
`pnpm install --frozen-lockfile --ignore-scripts` → builds → tests.

## Results
| Step | Result |
|---|---|
| `git clone cinema-dev-01` | ✅ 551 tracked files, commit matches origin |
| `pnpm install --frozen-lockfile` | ✅ 788 pkgs, 7.3s (off the pnpm store) |
| `pnpm --dir artifacts/api-server run build` | ✅ dist/index.mjs 3.7mb, queue-worker 2.3mb, production-worker 2.1mb |
| `pnpm --dir artifacts/studio run build` | ✅ 2311 modules, index.js 729kb (chunk-size warning only) |
| `tests/cinema-17a-actor-image.test.mts` | ✅ 16/16 |
| `tests/cinema-17b-actor-avatar.test.mts` | ✅ 19/19 |

## Prerequisites present in repo
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`
- `Dockerfile`, `Dockerfile.worker`, `entrypoint.sh`,
  `entrypoint.production-worker.sh`, `entrypoint.queue-worker.sh`
- `RESTORE.md` (change log), `.env.example` (env contract)
- Full `artifacts/api-server/src/` (76 files tracked)

## Missing at clone time (must be supplied by operator)
- `.env` — secrets (correctly excluded; reference `.env.example`)
- `certs/` bundle for DB TLS if required by target environment
- `node_modules` — reinstallable from lockfile

## Known gaps resolved in this task
- `.env.example` did not previously document `SESSION_SECRET`,
  `ALLOW_DEV_PRODUCTION_BYPASS`, `CORS_ALLOWED_ORIGINS`, R2_*, Supabase_*,
  Groq, Wavespeed, Replicate, worker-tuning vars. Now added (all blank).

## Known gaps still open
- Root `src/` is legacy (see `src/README.md` in production tree). Correctly
  `.gitignore`d; not required for build.
- `SESSION_SECRET` is unset on current production server → cookie login 503.
  Bearer auth still works. Not fixed in this task (per scope).

## Reversibility
The restore drill was performed in an isolated directory; production tree,
PM2 services, and databases were not touched.
