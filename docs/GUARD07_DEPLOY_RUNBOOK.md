# KAYAN-GUARD-07 — Deployment Runbook (loadEnv GPU leak fix)

> **Status:** package prepared, NOT deployed. Awaiting user approval.
> **Source commit:** 49d45e323f5e234519f9c84292dde16411dd9aac

## Package locations

| Role | Path |
|---|---|
| Staging (verified) | `/home/ubuntu/guard07-staging/dist/` |
| Staging hashes | `/home/ubuntu/guard07-staging/dist-sha256.txt` |
| Backup of current prod dist | `/home/ubuntu/guard07-backup-20261025-101502/` |
| Backup hashes | `.../guard07-backup-20261025-101502/dist-sha256.txt` |
| Production target | `/home/ubuntu/Nashash/artifacts/api-server/dist/` |

## Pre-deploy verification (must pass)

1. `cd /home/ubuntu/guard07-staging/dist && sha256sum -c ../dist-sha256.txt` — all OK
2. `cd /home/ubuntu/guard07-backup-20261025-101502 && sha256sum -c dist-sha256.txt` — all OK
3. `diff <(cd /home/ubuntu/guard07-backup-20261025-101502 && sha256sum *.mjs) <(cd /home/ubuntu/Nashash/artifacts/api-server/dist && sha256sum *.mjs)` — no output (prod unchanged since backup)

## Changed files (differ between staging and current prod)

| File | Notes |
|---|---|
| index.mjs | API entrypoint — used by nashash-app |
| index.mjs.map | Source map |
| queue-worker.mjs | Used by nashash-queue |
| queue-worker.mjs.map | Source map |
| production-worker.mjs | Auto-worker (currently disabled via NASHASH_DISABLE_AUTO_WORKER=1) |
| production-worker.mjs.map | Source map |
| pino-file.mjs + .map | Pino dependency — differs due to rebuild |
| pino-worker.mjs + .map | Pino dependency — differs due to rebuild |

**Unchanged** (byte-identical in both): `pino-pretty.mjs`, `pino-pretty.mjs.map`, `thread-stream-worker.mjs`, `thread-stream-worker.mjs.map`.

## Deployment steps

### 1. Pre-flight (read-only)
```bash
# a) Confirm no in-flight jobs (should be 0)
DB=$(grep '^DATABASE_URL=' ~/Nashash/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs | sed 's/sslmode=no-verify/sslmode=require/')
psql "$DB" -P pager=off -c "SELECT status, count(*) FROM gpu_jobs GROUP BY status;"

# b) Confirm processes online
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p['name'],p['pm2_env']['status']) for p in d])"

# c) Confirm prod hash still matches backup
diff <(cd /home/ubuntu/guard07-backup-20261025-101502 && sha256sum *.mjs) \
     <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *.mjs) && echo "PROD-UNCHANGED"

# d) Confirm staging hashes
cd /home/ubuntu/guard07-staging/dist && sha256sum -c ../dist-sha256.txt

### 5. Post-deploy verification
```bash
diff <(cd /home/ubuntu/guard07-staging/dist && sha256sum *.mjs) \
     <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *.mjs) && echo "DEPLOY-MATCHES-STAGING"
grep -c "GPU_SSH_TARGET=" ~/.pm2/logs/nashash-app-out*.log | tail -5
grep -c "GPU_SSH_TARGET=" ~/.pm2/logs/nashash-queue-out*.log | tail -5
```

Old log files may contain historical leaks; only lines after restart must be clean.

## Rollback

```bash
cd /home/ubuntu/guard07-backup-20261025-101502 && sha256sum -c dist-sha256.txt
cp -a /home/ubuntu/guard07-backup-20261025-101502/. ~/Nashash/artifacts/api-server/dist/
diff <(cd /home/ubuntu/guard07-backup-20261025-101502 && sha256sum *.mjs) \
     <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *.mjs) && echo "ROLLBACK-OK"
pm2 restart nashash-app
pm2 restart nashash-queue
```

Backup file names are fixed (no wildcard). No dist.backup-* pattern.

## Interruption estimate
- pm2 restart nashash-app: <=10s
- pm2 restart nashash-queue: <=10s
- Total: <=20s (sequential)
- Rollback: <=30s
- No GPU host, .env, DB, or timer changes.
