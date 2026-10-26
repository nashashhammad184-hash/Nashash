/**
 * KAYAN-STABILITY-04: behavioral test for lock TTL + recoverStale.
 * Simulates DB state transitions in-memory (no real DB).
 */
let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── Simulated lock state ─────────────────────────────────────────────
const STALE_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;

type LockState = { holderJobId: string | null; heartbeatAt: number };

function tryAcquireLock(lock: LockState, jobId: string, now: number): boolean {
  const isFree = lock.holderJobId === null || (now - lock.heartbeatAt) > STALE_MS;
  if (!isFree) return false;
  lock.holderJobId = jobId;
  lock.heartbeatAt = now;
  return true;
}

function heartbeat(lock: LockState, jobId: string, now: number): boolean {
  if (lock.holderJobId !== jobId) return false;
  lock.heartbeatAt = now;
  return true;
}

function recoverStale(lock: LockState, now: number): { freed: boolean } {
  if (lock.holderJobId && (now - lock.heartbeatAt) > STALE_MS) {
    lock.holderJobId = null;
    return { freed: true };
  }
  return { freed: false };
}

// ─── T1: two workers race — same jobId, only 1 acquires ───────────────
{
  const lock: LockState = { holderJobId: null, heartbeatAt: 0 };
  const t = 1_000_000;
  const a = tryAcquireLock(lock, "job-1", t);
  const b = tryAcquireLock(lock, "job-1", t);
  report("T1-a first acquire wins", a === true);
  report("T1-b second acquire rejected", b === false);
  report("T1-c lock holder is job-1", lock.holderJobId === "job-1");
}

// ─── T2: active job heartbeats → second acquire rejected over 4min ────
{
  const lock: LockState = { holderJobId: null, heartbeatAt: 0 };
  const t0 = 1_000_000;
  tryAcquireLock(lock, "job-A", t0);
  for (let m = 1; m <= 4; m++) heartbeat(lock, "job-A", t0 + m * HEARTBEAT_MS);
  const t4min = t0 + 4 * HEARTBEAT_MS;
  const second = tryAcquireLock(lock, "job-B", t4min);
  report("T2 active job holds lock at 4min", second === false);
}

// ─── T3: heartbeat misses → recovery frees lock, new job acquires ─────
{
  const lock: LockState = { holderJobId: null, heartbeatAt: 0 };
  const t0 = 1_000_000;
  tryAcquireLock(lock, "job-X", t0);
  // no heartbeat for >5min (crash)
  const t6min = t0 + 6 * 60_000;
  const rec = recoverStale(lock, t6min);
  report("T3-a recovery frees stale lock", rec.freed === true);
  report("T3-b lock holder null after recovery", lock.holderJobId === null);
  const acquired = tryAcquireLock(lock, "job-Y", t6min);
  report("T3-c new job acquires after recovery", acquired === true);
}

// ─── T4: recoverStale does NOT kill active job (60s ago HB) ───────────
{
  const lock: LockState = { holderJobId: null, heartbeatAt: 0 };
  const t0 = 1_000_000;
  tryAcquireLock(lock, "job-Z", t0);
  // worker restart at t0+90s, last HB 90s ago — old code (60s) would kill
  const t90s = t0 + 90_000;
  const rec = recoverStale(lock, t90s);
  report("T4-a active job NOT recovered (old code killed)", rec.freed === false);
  report("T4-b lock still held", lock.holderJobId === "job-Z");
}

// ─── T5: exactly at STALE_MS boundary → NOT freed (strict >) ──────────
{
  const lock: LockState = { holderJobId: "job-B", heartbeatAt: 1_000_000 };
  const exactlyStale = 1_000_000 + STALE_MS;
  const rec = recoverStale(lock, exactlyStale);
  report("T5-at-boundary not freed (> only)", rec.freed === false);
}

// ─── T6: heartbeat from wrong holder → rejected ───────────────────────
{
  const lock: LockState = { holderJobId: "job-A", heartbeatAt: 1_000_000 };
  const r = heartbeat(lock, "job-OTHER", 1_010_000);
  report("T6 heartbeat from wrong holder rejected", r === false);
  report("T6b heartbeatAt unchanged", lock.heartbeatAt === 1_000_000);
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
