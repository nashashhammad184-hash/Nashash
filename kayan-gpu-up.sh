#!/usr/bin/env bash
# Kayan GPU — dynamic IP discovery + tunnel + pm2 env refresh (74183)
# Idempotent: pm2 restart ONLY when IP changed.
set -uo pipefail

INSTANCE_ID="i-0e326a2b66deeaa0c"
REGION="eu-north-1"
KEY="$HOME/.ssh/kayan_gpu"
ENV_FILE="$HOME/Nashash/.env"
VIDEO_PORT=8080
LLM_PORT=8082
HEALTH_WAIT_SEC=180
HEALTH_RETRY_EVERY=5

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

# ---------- 1) Discover IP via AWS ----------
STATE=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)
if [ "$STATE" != "running" ]; then
  log "GPU state=$STATE — not running. Exit 0 (idle)."
  exit 0
fi
IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text 2>/dev/null)
if [ -z "$IP" ] || [ "$IP" = "None" ]; then
  log "no public IP yet (state=$STATE) — retry later"
  exit 1
fi

# ---------- 2) Compare with current .env ----------
CURRENT_IP=$(grep '^GPU_SSH_TARGET=' "$ENV_FILE" 2>/dev/null | sed 's#.*ubuntu@##')
IP_CHANGED=0
if [ "$CURRENT_IP" != "$IP" ]; then IP_CHANGED=1; fi

# Check if tunnel is alive for current IP
TUNNEL_OK=0
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${VIDEO_PORT}/health" 2>/dev/null || true)
if [ "$CODE" = "200" ]; then TUNNEL_OK=1; fi

# Idempotent exit: no change + tunnel healthy
if [ "$IP_CHANGED" = "0" ] && [ "$TUNNEL_OK" = "1" ]; then
  exit 0
fi

log "ACTION: IP_CHANGED=$IP_CHANGED TUNNEL_OK=$TUNNEL_OK IP=$IP"

# ---------- 3) Update .env ----------
if [ "$IP_CHANGED" = "1" ]; then
  if grep -q '^GPU_SSH_TARGET=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^GPU_SSH_TARGET=.*#GPU_SSH_TARGET=ubuntu@$IP#" "$ENV_FILE"
  else
    echo "GPU_SSH_TARGET=ubuntu@$IP" >> "$ENV_FILE"
  fi
  log "   .env updated: $(grep '^GPU_SSH_TARGET=' "$ENV_FILE")"
  ssh-keygen -R "$IP" >/dev/null 2>&1 || true
fi

# ---------- 4) Kill old tunnels ----------
pkill -f "ssh.*-L ${VIDEO_PORT}:127.0.0.1:${VIDEO_PORT}" 2>/dev/null || true
pkill -f "ssh.*-L ${LLM_PORT}:127.0.0.1:${LLM_PORT}" 2>/dev/null || true
sleep 1

# ---------- 5) Open tunnels ----------
log "opening SSH tunnels (8080 + 8082)"
ssh -i "$KEY" -f -N \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ConnectTimeout=10 -o ExitOnForwardFailure=yes \
  -L "${VIDEO_PORT}:127.0.0.1:${VIDEO_PORT}" \
  -L "${LLM_PORT}:127.0.0.1:${LLM_PORT}" \
  "ubuntu@$IP" || { log "ssh tunnel FAILED"; exit 1; }
sleep 2

# ---------- 6) Wait for /health ----------
WAITED=0; OK=0
while [ $WAITED -lt $HEALTH_WAIT_SEC ]; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${VIDEO_PORT}/health" || true)
  if [ "$CODE" = "200" ]; then OK=1; break; fi
  sleep $HEALTH_RETRY_EVERY
  WAITED=$((WAITED + HEALTH_RETRY_EVERY))
done
if [ "$OK" != "1" ]; then
  log "GPU /health not 200 after ${HEALTH_WAIT_SEC}s (last=$CODE). Tunnel open but worker down."
  exit 1
fi

# ---------- 7) pm2 refresh ONLY if IP changed ----------
if [ "$IP_CHANGED" = "1" ]; then
  log "IP changed — pm2 restart (queue-worker reads .env via loadEnv)"
  pm2 restart nashash-queue || pm2 start "/home/ubuntu/Nashash/artifacts/api-server/dist/queue-worker.mjs" --name nashash-queue --cwd "/home/ubuntu/Nashash/artifacts/api-server"
  pm2 restart nashash-app   || pm2 start "/home/ubuntu/Nashash/artifacts/api-server/dist/index.mjs" --name nashash-app --cwd "/home/ubuntu/Nashash"
  pm2 save
else
  log "IP unchanged — tunnel recreated, pm2 untouched"
fi

log "DONE"
exit 0
