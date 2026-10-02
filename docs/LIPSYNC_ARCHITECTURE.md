# LipSync Architecture — Nashash

## Current State (2026-10-02)

LIPSYNC_ENABLED=false

LipSync is disabled in production because:
- Wav2Lip requires a GPU worker for reasonable performance
- AWS GPU instance was decommissioned
- No external LipSync provider is configured

## Behavior when disabled

When LIPSYNC_ENABLED=false:
- LIP_SYNC_JOB returns { skipped: true, reason: "LIPSYNC_DISABLED_NO_GPU" }
- No HTTP call is made
- No GPU job is created
- Pipeline continues, not failed

## Guard rails

- If LIPSYNC_ENABLED=true and LIPSYNC_WORKER_URL is not set:
  - Job FAILS with MISCONFIGURATION
  - No silent fallback to 127.0.0.1:8080

## Future State (when GPU returns)

1. Set on Northflank:
   LIPSYNC_ENABLED=true
   LIPSYNC_WORKER_URL=http://gpu-worker:8080
2. Restart service

## What is NOT affected

- VIDEO_JOB (I2V/T2V)
- KayanGPU code path
- LIPSYNC_WORKER_URL env var
- Wav2Lip integration scripts

## Env Variables

| Name | Required | Values | Notes |
|---|---|---|---|
| LIPSYNC_ENABLED | Yes in prod | true / false | Default false |
| LIPSYNC_WORKER_URL | Only if ENABLED=true | URL | No localhost fallback |
