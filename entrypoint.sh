#!/bin/sh
set -e

# KAYAN-ENTRYPOINT: run both index.mjs (HTTP) and queue-worker.mjs (GPU jobs)
# in the same container. The worker is a poll loop with no port; the server
# holds the HTTP port. If either exits, the container exits.

echo "[entrypoint] starting queue-worker (background)"
node --enable-source-maps artifacts/api-server/dist/queue-worker.mjs &
QW_PID=$!
echo "[entrypoint] queue-worker pid=$QW_PID"

echo "[entrypoint] starting api-server (foreground)"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
