# Production Environment Variables — Nashash

Last updated: 2026-10-02
Secret values are NEVER recorded in this file.

================================================================
REQUIRED
================================================================
NODE_ENV=production
LOG_LEVEL=info
PORT=(provided by Northflank)

DATABASE_URL=postgresql://.../<db>?sslmode=no-verify
QUEUE_DATABASE_URL=postgresql://.../<queue-db>?sslmode=no-verify

PRODUCTION_API_TOKEN=<64-hex, rotated 2026-10-02, stored in Northflank only>

================================================================
EXTERNAL_VIDEO
================================================================
VIDEO_PROVIDER=external|kayangpu  (default: kayangpu)
VIDEO_EXTERNAL_KIND=wavespeed      (default: wavespeed)

WAVESPEED_API_KEY=<NOT SET YET>
WAVESPEED_SUBMIT_URL=https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-video-1.5/image-to-video
WAVESPEED_STATUS_URL=https://api.wavespeed.ai/api/v3/predictions/{id}/result
WAVESPEED_RESULT_URL=https://api.wavespeed.ai/api/v3/predictions/{id}/result

MAX_VIDEO_COST_USD=0.30            (cost guard, hard ceiling per job)

================================================================
VOICE
================================================================
VOICE_PROVIDER=deepgram
DEEPGRAM_API_KEY=<PRESENT; ROTATION PENDING>
DEEPGRAM_TTS_MODEL=aura-asteria-en

================================================================
LIPSYNC
================================================================
LIPSYNC_ENABLED=false              (true only when GPU worker exists)
LIPSYNC_WORKER_URL=<empty until GPU returns>
LIPSYNC_WORKER_URL is REQUIRED if LIPSYNC_ENABLED=true. No localhost fallback.

================================================================
GPU_ONLY (unused when VIDEO_PROVIDER=external)
================================================================
GPU_WORKER_URL=http://127.0.0.1:8080     (default, only used by KayanGPU path)
GPU_WORKER_TOKEN=<same as KAYANGPU_API_KEY on GPU host>
GPU_SSH_KEY=/home/ubuntu/.ssh/kayan_gpu
GPU_SSH_TARGET=ubuntu@<gpu-ip>
GPU_WORKER_TIMEOUT=1800000
GPU_POLL_INTERVAL=5000
VIDEO_WORKER_URL=http://127.0.0.1:8080
LIPSYNC_WORKER_URL=<empty>
LLM_WORKER_URL=http://127.0.0.1:8082
KAYAN_LLM_URL=http://127.0.0.1:8082
KAYAN_FACE_PYTHON=<local python path>
NASHASH_VIDEO_DIR=<uploads/videos path>

================================================================
OPTIONAL
================================================================
VIDEO_WORKER_URL
LLM_PROVIDER=local-gpu
KAYAN_ENV_FILE=<path to .env; default /home/ubuntu/Nashash/.env>

================================================================
LEGACY (not used in production path)
================================================================
GROQ_API_KEY
GROQ_MODEL
REPLICATE_API_TOKEN
REPLICATE_VIDEO_MODEL_VERSION
REPLICATE_LIPSYNC_MODEL_VERSION

================================================================
SECURITY
================================================================
ALLOW_DEV_PRODUCTION_BYPASS=<unset in prod>  (only for local dev)

requireProductionAuth fails-closed:
  - If PRODUCTION_API_TOKEN is set: enforce Bearer token
  - If missing and NODE_ENV=development + ALLOW_DEV_PRODUCTION_BYPASS=true: allow
  - Otherwise: HTTP 503

================================================================
ROTATION STATUS
================================================================
PRODUCTION_API_TOKEN=ROTATED (2026-10-02)
AIVEN_DB_PASSWORD=ROTATED (2026-10-02)
DEEPGRAM_ROTATION_REQUIRED=YES
WAVESPEED_API_KEY=NOT_SET_YET
