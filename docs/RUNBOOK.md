# KAYAN RUNBOOK

## Audio Module (KAYAN-11 series)

### Architecture
- Phone Worker: generates Arabic audio via Edge-TTS, uploads to Supabase, updates shots.
- Server Pipeline: waits for phone (30s), then falls back to Deepgram for non-Arabic, or fails fast for Arabic.
- Heartbeat: phone pings every 30s; healthz reports phoneOnline.

### Common Scenarios

#### Wrong-language audio
Legacy shots produced before KAYAN-11b.1. See KAYAN-11b.5 in KNOWN_ISSUES.

#### Arabic video fails
1. Check GET /api/healthz -> audio.phoneOnline.
2. If false: start kayan_audio_worker.py on phone.
3. If true but shot stuck: POST /shots/:id/release-claim.

#### Stuck PROCESSING shot
POST /shots/:id/release-claim.

### Rollback
1. Stop phone.
2. Revert code.
3. Deploy.
4. DROP TABLE worker_heartbeats.
5. DROP COLUMN audio_claimed_at.
