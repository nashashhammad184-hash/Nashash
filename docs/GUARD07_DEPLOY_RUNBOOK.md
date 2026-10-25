# KAYAN-GUARD-07/08 — Deployment Runbook (loadEnv GPU leak fix)

> **Status:** package prepared, NOT deployed. Awaiting user approval.
> **Source commit:** 49d45e323f5e234519f9c84292dde16411dd9aac
> **Revised by:** GUARD-08 (path and safety corrections)

## Package locations

| Role | Path |
|---|---|
| Staging dist | `/home/ubuntu/guard07-staging/dist/` |
| Staging hashes | `/home/ubuntu/guard07-staging.sha256.txt` |
| Backup dist | `/home/ubuntu/guard07-backup-20261025-101502/dist/` |
| Backup hashes | `/home/ubuntu/guard07-backup-20261025-101502.sha256.txt` |
| Production target | `/home/ubuntu/Nashash/artifacts/api-server/dist/` |

Hash files live OUTSIDE the dist/ folders, so `cp dist/.` never pollutes
the target with a checker file.

## File set

`staging/dist`, `backup/dist`, and `prod/dist` all contain exactly the same
14 filenames (verified with `diff <(ls a) <(ls b)`):
index.mjs, index.mjs.map, pino-file.mjs(.map), pino-pretty.mjs(.map),
pino-worker.mjs(.map), production-worker.mjs(.map), queue-worker.mjs(.map),
thread-stream-worker.mjs(.map).


## Pre-deploy verification (all must pass)

```bash
# V1: staging hashes
cd /home/ubuntu/guard07-staging/dist && sha256sum -c ../../guard07-staging.sha256.txt

# V2: backup hashes
cd /home/ubuntu/guard07-backup-20261025-101502/dist && sha256sum -c ../../guard07-backup-20261025-101502.sha256.txt

# V3: prod still equals backup (nothing drifted since backup)
diff <(cd /home/ubuntu/guard07-backup-20261025-101502/dist && sha256sum *) \
     <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *) && echo "PROD-UNCHANGED"

# V4: file sets match (no orphan file in any dir)
diff <(ls /home/ubuntu/guard07-staging/dist/) <(ls ~/Nashash/artifacts/api-server/dist/) && echo "FILE-SETS-MATCH"

# V5: no in-flight jobs
DB=$(grep '^DATABASE_URL=' ~/Nashash/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs | sed 's/sslmode=no-verify/sslmode=require/')
psql "$DB" -P pager=off -c "SELECT status, count(*) FROM gpu_jobs GROUP BY status;"

# V6: both services online
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p['name'],p['pm2_env']['status']) for p in d])"
```
## Deploy (sequential, gated)

### Step 1 — Copy staging to production
```bash
cp -a /home/ubuntu/guard07-staging/dist/. ~/Nashash/artifacts/api-server/dist/
diff <(cd /home/ubuntu/guard07-staging/dist && sha256sum *) <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *) && echo COPY-OK
```
If COPY-OK fails: STOP and Rollback.

### Step 2 — Restart nashash-app only
```bash
pm2 restart nashash-app
sleep 10
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p[\"name\"],p[\"pm2_env\"][\"status\"]) for p in d if p[\"name\"]==\"nashash-app\"])"
pm2 logs nashash-app --lines 20 --nostream | grep -E "loadEnv|rror" | tail -10
curl -s -o /dev/null -w "APP-HTTP=%{http_code}\n" http://127.0.0.1:3000/
```
Pass: online + gpuSshTarget=configured (no IP) + APP-HTTP=200.
If any fails: STOP, do NOT restart queue, run Rollback.

### Step 3 — Restart nashash-queue only (only if Step 2 passed)
```bash
pm2 restart nashash-queue
sleep 10
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p[chr(110)+chr(97)+chr(109)+chr(101)],p[chr(112)+chr(109)+chr(50)+chr(95)+chr(101)+chr(110)+chr(118)][chr(115)+chr(116)+chr(97)+chr(116)+chr(117)+chr(115)]) for p in d])"
pm2 logs nashash-queue --lines 20 --nostream | grep -E "loadEnv|rror" | tail -10
```
Pass: online + gpuSshTarget=configured (no IP).
If it fails: STOP and Rollback.

### Step 4 — Post-deploy verification
```bash
diff <(cd /home/ubuntu/guard07-staging/dist && sha256sum *) <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *) && echo DEPLOY-MATCHES-STAGING
pm2 logs nashash-app --lines 50 --nostream | grep -c "GPU_SSH_TARGET="
pm2 logs nashash-queue --lines 50 --nostream | grep -c "GPU_SSH_TARGET="
```
New logs must show 0 leaks.

## Rollback (verified, fixed names, no wildcard)
```bash
# R1: verify backup hashes
cd /home/ubuntu/guard07-backup-20261025-101502/dist && sha256sum -c ../../guard07-backup-20261025-101502.sha256.txt
# R2: restore (same layout as deploy)
cp -a /home/ubuntu/guard07-backup-20261025-101502/dist/. ~/Nashash/artifacts/api-server/dist/
# R3: verify restore matches backup
diff <(cd /home/ubuntu/guard07-backup-20261025-101502/dist && sha256sum *) <(cd ~/Nashash/artifacts/api-server/dist && sha256sum *) && echo ROLLBACK-OK
# R4: restart both services
pm2 restart nashash-app && sleep 10
pm2 restart nashash-queue && sleep 10
# R5: confirm online + HTTP 200
curl -s -o /dev/null -w "APP-HTTP=%{http_code}\n" http://127.0.0.1:3000/
```

## Interruption estimate
- Step 2 (app restart): <=10s
- Step 3 (queue restart): <=10s
- Total user-facing: <=20s
- Rollback full cycle: <=30s
- No GPU host, .env, DB, or timer changes.
