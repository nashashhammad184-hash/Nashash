# GPU_WORKER_TOKEN Rotation Plan (KAYAN-GUARD-03)

> **Status:** planning only — no rotation performed.
> **Secret value:** never stored here. Rotate via `read -s` on the server.

## 1. Where the token is used

| Location | File | Role |
|---|---|---|
| `nashash-app` (API) | `artifacts/api-server/src/lib/kayanGpuProvider.ts:45,55` | Client — sends `X-API-Key` to GPU host |
| `nashash-app` (API) | `artifacts/api-server/src/lib/providers/script/LocalGpuLlmProvider.ts:15,20` | Client — sends `X-API-Key` to GPU host for LLM |
| `nashash-queue` (Worker) | `artifacts/api-server/src/queue-worker.ts:48,49` | Client — sends `X-API-Key` to GPU host |
| **GPU host (remote)** | not in this repo (`GPU_SSH_TARGET`) | **Server-side validator** — accepts/rejects `X-API-Key` |

The token is **not** used to authenticate between `nashash-app` and `nashash-queue`. It authenticates the AWS services → remote GPU host.

## 2. Rotation order (minimizes downtime)

The GPU host is the sole validator. Both consumers (`nashash-app` + `nashash-queue`) must be updated before the old token stops working on the GPU host.

**Phase 1 — Add new token alongside old (no outage)**
1. SSH to GPU host (`GPU_SSH_TARGET`).
2. Locate the file that holds the accepted token (e.g. `~/.kayan/gpu.env` or service env). **Do not print it.**
3. Append a *secondary* accepted token `GPU_WORKER_TOKEN_NEXT` (short `< 5 min` window).
   - If the GPU host validates a single token only, skip to Phase 2 and accept a brief window where some requests fail.
4. Reload the GPU service (its own process manager — not PM2 on this box).

**Phase 2 — Update consumers**
5. On this AWS server: update `GPU_WORKER_TOKEN` in `.env` via `read -s` (never echo).
6. `pm2 restart nashash-app` — verify with the read-only check below.
7. `pm2 restart nashash-queue` — verify with the read-only check below.
   - Alternatively use `pm2 reload nashash-app` / `pm2 reload nashash-queue` for zero-downtime if the processes handle `SIGINT` cleanly.

**Phase 3 — Remove old token**
8. Once both consumers report success on the new token, remove `GPU_WORKER_TOKEN_NEXT` (or the old primary) from the GPU host.
9. Confirm no requests with the old token in the GPU host logs for 24h.

**Phase 4 — Cleanup**
10. `pm2 save` on this server to persist the new env across reboots.
11. Record the rotation date here (never the value):
    - Rotated on: `____-__-__` by: `____`.

## 3. Verification after each consumer restart

Read-only commands (no token in output):

```bash
# Confirm process is up
pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print([(p['name'],p['pm2_env']['status']) for p in d])"

# Confirm the token is loaded (present-or-absent, not the value)
pm2 env <id> 2>/dev/null | grep -c '^GPU_WORKER_TOKEN='   # expect 1

# End-to-end: submit a trivial LLM_JOB to the queue and confirm it reaches the GPU host
# (Check GPU host logs for an authenticated request arriving with the new token.)
```
