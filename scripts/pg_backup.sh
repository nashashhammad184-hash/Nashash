#!/usr/bin/env bash
# KAYAN-FIX-10 — Daily PostgreSQL backup with 7-day retention.
set -euo pipefail

ENV_FILE="/home/ubuntu/Nashash/.env"
BACKUP_DIR="/data/backups"
RETENTION=7
STAMP=$(date -u +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/kayan_${STAMP}.sql.gz"

DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$DB_URL" ]; then
  echo "[pg_backup] DATABASE_URL not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "[pg_backup] $(date -u +%FT%TZ) starting dump -> $OUT"
pg_dump --no-owner --no-privileges "$DB_URL" | gzip -9 > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "[pg_backup] dump file empty, aborting" >&2
  rm -f "$OUT"
  exit 1
fi
echo "[pg_backup] wrote $(stat -c%s "$OUT") bytes"

# Retention: keep the newest $RETENTION *.sql.gz, delete the rest.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/kayan_*.sql.gz 2>/dev/null | tail -n +$((RETENTION+1)))
for f in "${OLD[@]}"; do
  echo "[pg_backup] removing old $f"
  rm -f "$f"
done
echo "[pg_backup] done. current files:"
ls -1t "$BACKUP_DIR"/kayan_*.sql.gz 2>/dev/null | head -20
