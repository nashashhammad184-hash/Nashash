# KAYAN Known Issues & Migrations

## Migration: shots.audio_claimed_at (KAYAN-11b.2)

**Applied:** 2026-10-31 (Supabase SQL Editor)
**Commit:** 05d079e

**SQL:**
ALTER TABLE shots ADD COLUMN audio_claimed_at TIMESTAMP NULL;

**Rollback (order matters):**
1. git revert 05d079e 3970eb0 0869784 (backend code that uses the column)
2. Deploy (Render + Northflank)
3. ALTER TABLE shots DROP COLUMN audio_claimed_at;
4. pkill -f kayan_audio_worker (stop phone worker)

**Why order:** Reverting DB alone breaks POST /shots/:id/claim (uses column, returns 500).
Reverting code first makes the endpoint dead-but-harmless, then dropping column is safe.

**Data loss risk:** None. All values are NULL at time of apply (verified: 40 shots).

## Legacy Arabic Deepgram Audio (KAYAN-11b.5 - PENDING)

**Status:** Audited 2026-10-31, awaiting user decision.
**Finding:** 1 shot with Arabic dialogue has audio produced by Deepgram.
**Impact:** Any video render using these shots will have wrong-language audio.

**Fix (manual, when user decides):**
-- 1. Backup first
CREATE TABLE shots_legacy_audio_backup AS SELECT id, audio_url, audio_status FROM shots WHERE (dialogue ~ '[؀-ۿ]') AND audio_status = 'COMPLETED' AND audio_url NOT LIKE '/api/storage/supabase/%';
-- 2. Reset to QUEUED
UPDATE shots SET audio_status = 'QUEUED', audio_url = NULL, audio_claimed_at = NULL WHERE (dialogue ~ '[؀-ۿ]') AND audio_status = 'COMPLETED' AND audio_url NOT LIKE '/api/storage/supabase/%';
-- 3. Verify
SELECT COUNT(*) FROM shots WHERE audio_status = 'QUEUED' AND dialogue ~ '[؀-ۿ]';
**Note:** Files in Supabase storage are NOT deleted.


## KI-XXX: Northflank Security Incident (HIGH - DEFERRED)
**Discovered:** 2026-10-31
**Status:** DEFERRED (after KAYAN-15/KAYAN-13b)
**Cause:** Northflank banner: 'Please rotate all user defined credentials.'
**Exposed credentials (may need rotation):** GROQ_API_KEY, WAVESPEED_API_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL password, PRODUCTION_API_TOKEN, SESSION_SECRET.
**Fix (KAYAN-12):**
1. Rotate each via provider dashboard.
2. Update Render + Northflank env vars.
3. Re-deploy.
4. Update phone worker script with new PRODUCTION_API_TOKEN.

## KI-XXX: edge-tts Sounds Robotic (LOW)
**Discovered:** 2026-11-01
**Status:** Known, deferred.
**Cause:** Microsoft Neural voices from ~2019, designed for announcements, not dramatic.
**Options (future):**
- Munsit API (recommended).
- Azure Neural with SSML.
- ElevenLabs.
**Interim mitigation:**
- Add --rate=-8% --pitch=-3Hz to edge-tts command.
- Add post-processing EQ filters (KAYAN-15b).
