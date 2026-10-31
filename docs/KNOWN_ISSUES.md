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
