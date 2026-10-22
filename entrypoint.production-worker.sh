#!/bin/sh
set -e
echo "[entrypoint] role=production-worker NASHASH_DISABLE_AUTO_WORKER=${NASHASH_DISABLE_AUTO_WORKER:-0}"
exec node --enable-source-maps artifacts/api-server/dist/production-worker.mjs
