#!/bin/sh
set -e
echo "[entrypoint] role=queue-worker LIPSYNC_ENABLED=${LIPSYNC_ENABLED:-false}"
exec node --enable-source-maps artifacts/api-server/dist/queue-worker.mjs
