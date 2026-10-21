#!/bin/sh
set -e

# KAYAN-ENTRYPOINT: run both index.mjs (HTTP) and queue-worker.mjs (GPU jobs)
# in the same container. The worker is a poll loop with no port; the server
# holds the HTTP port. If either exits, the container exits.
#
# KAYAN-TASK-DEPLOY-07: NASHASH_DISABLE_AUTO_WORKER=1 disables the worker
# entirely (API-only mode). This mirrors the in-process gate already present
# in artifacts/api-server/src/index.ts (TASK-DEPLOY-04). Set by Dockerfile
# ENV in the runtime image, or overridden via Render environment variables.

if [ "${NASHASH_DISABLE_AUTO_WORKER:-0}" = "1" ]; then
  echo "[entrypoint] queue-worker disabled (NASHASH_DISABLE_AUTO_WORKER=1) — API-only mode"
else
  echo "[entrypoint] starting queue-worker (background)"
  node --enable-source-maps artifacts/api-server/dist/queue-worker.mjs &
  QW_PID=$!
  echo "[entrypoint] queue-worker pid=$QW_PID"
fi

echo "[entrypoint] starting api-server (foreground)"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
