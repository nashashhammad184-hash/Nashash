# GPU_WORKER_TOKEN Rotation Plan

> Status: planning only — no rotation performed.
> Secret value: never stored here. Rotate via `read -s` on the server.
> History: v1 (GUARD-03) → v2 (GUARD-04) → v3 (GUARD-05 corrections).

## 1. Where the token is used

| Location | File | Role |
|---|---|---|
| nashash-app | lib/kayanGpuProvider.ts:45,55 | Client, X-API-Key |
| nashash-app | lib/providers/script/LocalGpuLlmProvider.ts:15,20 | Client, X-API-Key (LLM) |
| nashash-queue | queue-worker.ts:48,49 | Client, X-API-Key |
| GPU host (remote) | not in repo (`GPU_SSH_TARGET`) | Validator |

Token is NOT used between nashash-app and nashash-queue. Both are independent
clients toward the remote GPU host. Loaded centrally by loadEnv.ts (dotenv
override) from /home/ubuntu/Nashash/.env at process start.

## 2. Pre-rotation conditions (all required)

1. gpu_jobs has no stuck RUNNING rows (SQL read-only check).
2. kayan-gpu-discovery.timer state verified and confirmed:
   - `systemctl is-active kayan-gpu-discovery.timer` (record state).
   - Timer fires kayan-gpu-up.sh every 120s; if GPU IP changes it calls
     `pm2 restart` on both services.
   - Do NOT stop the timer unless operator confirms GPU IP is stable for the
     rotation window. If stopped, re-enable immediately after Phase 3.
3. `pm2 jlist` shows nashash-app and nashash-queue = online.
4. Both run in fork mode, single instance (confirmed). `pm2 reload` is NOT
   safe here. Use `pm2 restart` only.
5. A working copy of .env exists for rollback (see §7). Never touch
   .env.save* or backups during rotation.
6. GPU host dual-token support MUST be confirmed by the operator from its
   own config. Do not assume a second accepted token exists. If not, budget
   a <=60s window of failed GPU calls in Phase 2.

## 3. Where the GPU host validator lives

Not in this repository. Operator must SSH to GPU_SSH_TARGET and inspect the
GPU service environment for whatever variable holds the accepted key (name
unknown — do not guess). Never print the value.

## 4. Rotation phases

### Phase 1 — GPU host (operator-executed)

If dual-token supported:
1. SSH to GPU_SSH_TARGET.
2. Generate new value: `openssl rand -hex 32` (use read -s; do not echo).
3. Add as secondary accepted key (name per GPU host config).
4. Reload GPU service via its own process manager.

If single-token only: skip Phase 1; accept <=60s failed GPU calls.

### Phase 2 — Update both consumers (this box)

1. Update GPU_WORKER_TOKEN in /home/ubuntu/Nashash/.env via read -s.
2. `pm2 restart nashash-app` (restart, NOT reload).
3. Verify (§5).
4. `pm2 restart nashash-queue`.
5. Verify (§5).

### Phase 3 — Verify operationally

1. Monitor gpu_jobs 5 min: no QUEUED beyond PRODUCTION_WORKER_POLL_MS.
2. Check GPU host logs for successful requests (status, not token value).
3. If timer was stopped in §2, re-enable now.

### Phase 4 — Cleanup

1. Do NOT delete .env.save* or .env.before-* during rotation. If cleanup
   is desired, do it under a separate reviewed task after verifying an
   alternative safe backup exists.
2. See §6 for handling historical copies.
3. `pm2 save` ONLY AFTER Phase 3 verification.
4. Verify ~/.pm2/dump.pm2 remains 600.
5. Record rotation date here (never value):
   - Rotated on: ____-__-__ by: ____.

## 5. Verification (read-only, no secret printing)

Do NOT run raw `pm2 env` or `pm2 describe` — they may print env values.

Safe checks:
- pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p['name'],p['pm2_env']['status']) for p in d])"
- pm2 env <id> 2>/dev/null | awk -F= '/^GPU_WORKER_TOKEN=/{print "present len="length($2)}'
- End-to-end: submit a trivial job, observe GPU host side (status not value)

## 6. Historical copies of the token

The old value may exist in:
- .env.save, .env.save.1..8, .env.before-aiven-* (600, ubuntu-only)
- ~/.pm2/dump.pm2 (now 600 after GUARD-05)
- pm2 describe output (only if invoked; not stored)

After rotation confirmed, consider a SECOND rotation to invalidate any
forgotten copy. Do NOT delete .env.save* as part of the rotation task;
schedule archival in a separate reviewed step.

## 7. Rollback (safe, no secret printing)

1. Operator keeps previous token in password manager before touching .env.
2. If pm2 restart fails to bring a service up:
   - pm2 logs <name> --lines 20 (logs show "loaded" messages only)
   - pm2 start /home/ubuntu/Nashash/artifacts/api-server/dist/<name>.mjs
     --name <name> --cwd <cwd> (paths per kayan-gpu-up.sh:92-93)
3. If GPU calls fail with 401 after restart:
   - Restore previous value in .env (read -s, never echo)
   - pm2 restart both services
   - On GPU host, re-add previous token; reload GPU service
4. Verify gpu_jobs drains normally; else escalate before further changes.

## 8. Prohibitions during rotation

- No `git add .` or `git add -A`
- No commit of .env, .env.save*, or any dump file
- No `pm2 reload` (fork mode single instance)
- No unfiltered `pm2 env` / `pm2 describe`
- No deletion of .env.save* or src/ during rotation
- No changes to main or render-deploy
- No SESSION_SECRET addition as part of this task
