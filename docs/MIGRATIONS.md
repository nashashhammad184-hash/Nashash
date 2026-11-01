# Migrations Log

## 2026-10-31 — worker_heartbeats (KAYAN-11b.3)

**Commit:** b3481b2
**Applied via:** Supabase SQL Editor

**SQL:**
CREATE TABLE worker_heartbeats (
  name TEXT PRIMARY KEY,
  last_seen_at TIMESTAMP NOT NULL,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

**Rollback (order matters):**
1. git revert b3481b2 (removes /workers/heartbeat + healthz.audio)
2. Deploy to Render
3. DROP TABLE worker_heartbeats; (via Supabase SQL Editor)
4. pkill -f kayan_audio_worker (phone stops sending)

**Why order:** Reverting DB first breaks POST /workers/heartbeat (500 on every phone heartbeat, noisy logs). Reverting code makes endpoint dead-but-harmless.
**Data loss:** None — heartbeats are ephemeral. Losing table just sets phoneOnline=false until phone reconnects.

## 2026-10-31 - shots.audio_claimed_at (KAYAN-11b.2)
**Applied:** via Supabase SQL Editor
**Commit:** a1f6080
**SQL:**
ALTER TABLE shots ADD COLUMN audio_claimed_at TIMESTAMP NULL;
**Rollback:**
1. git revert a1f6080
2. Deploy
3. ALTER TABLE shots DROP COLUMN audio_claimed_at;
4. Stop phone worker.
**Data loss:** None.

## 2026-10-31 - worker_heartbeats table (KAYAN-11b.3)
**Applied:** via Supabase SQL Editor
**Commit:** b3481b2
**SQL:**
CREATE TABLE worker_heartbeats (name TEXT PRIMARY KEY, last_seen_at TIMESTAMP NOT NULL, metadata TEXT, created_at TIMESTAMP DEFAULT NOW());
**Rollback:**
1. git revert b3481b2
2. Deploy
3. DROP TABLE worker_heartbeats;
4. Stop phone worker.
**Data loss:** None.
