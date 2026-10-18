import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  acquireLock,
  releaseLock,
  runMigration,
} from "../scripts/r2-migrate.mts";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

function tmpLock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t89-"));
  return { dir, lock: path.join(dir, "cp.jsonl.lock"), cp: path.join(dir, "cp.jsonl") };
}

const myHost = os.hostname();

// ═══ TASK-89-01: foreign hostname + live local PID → refuse + keep lock ═══
{
  const { dir, lock, cp } = tmpLock();
  fs.writeFileSync(lock, JSON.stringify({
    pid: process.pid, startedAt: new Date().toISOString(),
    hostname: "somewhere-else", sourceDir: dir, checkpointPath: cp,
    ownerToken: "foreign-token",
  }));
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  report("TASK-89-01 foreign-host refused", r.ok === false, JSON.stringify(r));
  report("TASK-89-01 lock preserved", fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-02: foreign hostname + dead local PID → refuse + keep lock ═══
{
  const { dir, lock, cp } = tmpLock();
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999_999_999, startedAt: new Date().toISOString(),
    hostname: "somewhere-else", sourceDir: dir, checkpointPath: cp,
    ownerToken: "foreign-token",
  }));
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  report("TASK-89-02 foreign-host+dead-pid refused", r.ok === false, JSON.stringify(r));
  report("TASK-89-02 lock preserved", fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-03: same host + live PID → refuse (running) ═══
{
  const { dir, lock, cp } = tmpLock();
  fs.writeFileSync(lock, JSON.stringify({
    pid: process.pid, startedAt: new Date().toISOString(),
    hostname: myHost, sourceDir: dir, checkpointPath: cp,
    ownerToken: "self-test",
  }));
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  report("TASK-89-03 same-host live pid refused", r.ok === false);
  report("TASK-89-03 lock preserved", fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-04: same host + DEAD pid → refuse auto-recover + keep lock ═══
{
  const { dir, lock, cp } = tmpLock();
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999_999_999, startedAt: new Date().toISOString(),
    hostname: myHost, sourceDir: dir, checkpointPath: cp,
    ownerToken: "stale-same-host",
  }));
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  report("TASK-89-04 same-host dead pid refused", r.ok === false, JSON.stringify(r));
  report("TASK-89-04 lock preserved", fs.existsSync(lock));
  report("TASK-89-04 error mentions manual", /manual/i.test((r as any).error ?? ""));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-05: acquire then release (ownerToken match) → file gone ═══
{
  const { dir, lock, cp } = tmpLock();
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  report("TASK-89-05 acquire ok", r.ok === true);
  const info = JSON.parse(fs.readFileSync(lock, "utf-8"));
  report("TASK-89-05 ownerToken persisted", typeof info.ownerToken === "string" && info.ownerToken.length > 20);
  if (r.ok) r.handle.release();
  report("TASK-89-05 lock deleted after release", !fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-06: tampered ownerToken → release refuses to delete ═══
{
  const { dir, lock, cp } = tmpLock();
  const r = acquireLock(lock, { sourceDir: dir, checkpointPath: cp });
  if (r.ok) {
    // Tamper: replace ownerToken with a different one
    fs.writeFileSync(lock, JSON.stringify({
      ...JSON.parse(fs.readFileSync(lock, "utf-8")),
      ownerToken: "attacker-token",
    }));
    r.handle.release();
    report("TASK-89-06 tampered token → lock NOT deleted", fs.existsSync(lock));
  } else {
    report("TASK-89-06 tampered token → lock NOT deleted", false, "acquire failed");
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-07: missing lock → release safe no-op ═══
{
  const { dir, lock } = tmpLock();
  let threw = false;
  try { releaseLock(lock, "any-token"); } catch { threw = true; }
  report("TASK-89-07 release on missing lock safe", !threw);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-08: corrupt lock data → release refuses to delete ═══
{
  const { dir, lock } = tmpLock();
  fs.writeFileSync(lock, "NOT-JSON-AT-ALL");
  releaseLock(lock, "any-token");
  report("TASK-89-08 corrupt lock preserved", fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-09: lock data without ownerToken → release refuses ═══
{
  const { dir, lock } = tmpLock();
  fs.writeFileSync(lock, JSON.stringify({ pid: 1, hostname: "x", startedAt: "y", sourceDir: "s", checkpointPath: "c" }));
  releaseLock(lock, "any-token");
  report("TASK-89-09 lock without ownerToken preserved", fs.existsSync(lock));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-10: two concurrent acquires → only one wins ═══
{
  const { dir, lock, cp } = tmpLock();
  const results = await Promise.all([
    Promise.resolve().then(() => acquireLock(lock, { sourceDir: dir, checkpointPath: cp })),
    Promise.resolve().then(() => acquireLock(lock, { sourceDir: dir, checkpointPath: cp })),
    Promise.resolve().then(() => acquireLock(lock, { sourceDir: dir, checkpointPath: cp })),
  ]);
  const wins = results.filter((r: any) => r.ok === true).length;
  const losses = results.filter((r: any) => r.ok === false).length;
  report("TASK-89-10 exactly 1 winner", wins === 1, `wins=${wins}`);
  report("TASK-89-10 exactly 2 losers", losses === 2, `losses=${losses}`);
  for (const r of results) if ((r as any).ok) (r as any).handle.release();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ═══ TASK-89-11: runMigration releases lock on SUCCESS ═══
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t89-mig-"));
  fs.mkdirSync(path.join(root, "videos"), { recursive: true });
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(100));
  const cp = path.join(root, "..", `t89-cp-${Date.now()}.jsonl`);
  const lock = cp + ".lock";
  const storage = new Map<string, Buffer>();
  const mock: any = {
    name: "r2",
    async write(k: string, b: Buffer) { storage.set(k, Buffer.from(b)); return `/api/storage/r2/${k}`; },
    async writeFromFile(p: string, k: string) { storage.set(k, fs.readFileSync(p)); return `/api/storage/r2/${k}`; },
    async read(k: string) { const b = storage.get(k); if (!b) throw new Error("NF"); return Buffer.from(b); },
    async exists(k: string) { return storage.has(k); },
    async delete(k: string) { storage.delete(k); },
    async localPath(k: string) {
      const b = storage.get(k); if (!b) throw new Error("NF");
      const p = path.join(root, `dl_${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(p, b); return p;
    },
    async cleanup(p: string) { try { fs.unlinkSync(p); } catch {} },
    publicUrl(k: string) { return `/api/storage/r2/${k}`; },
  };
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: lock,
  });
  report("TASK-89-11 lock released after success", !fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-89-12: runMigration releases lock on FAILURE ═══
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t89-mig-fail-"));
  fs.mkdirSync(path.join(root, "videos"), { recursive: true });
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(100));
  const cp = path.join(root, "..", `t89-cp-fail-${Date.now()}.jsonl`);
  const lock = cp + ".lock";
  const mock: any = {
    name: "r2",
    async write() { throw new Error("simulated network"); },
    async writeFromFile() { throw new Error("simulated network"); },
    async read() { throw new Error("NF"); },
    async exists() { return false; },
    async delete() {},
    async localPath() { throw new Error("NF"); },
    async cleanup() {},
    publicUrl(k: string) { return `/api/storage/r2/${k}`; },
  };
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: lock,
  });
  report("TASK-89-12 lock released after failure", !fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-89-13: foreign lock is NOT deleted by a failed runMigration ═══
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t89-foreign-"));
  fs.mkdirSync(path.join(root, "videos"), { recursive: true });
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(100));
  const cp = path.join(root, "..", `t89-foreign-${Date.now()}.jsonl`);
  const lock = cp + ".lock";
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999_999_999, startedAt: new Date().toISOString(),
    hostname: "far-away", sourceDir: root, checkpointPath: cp,
    ownerToken: "foreign",
  }));
  let threw = false;
  try {
    await runMigration({
      sourceDir: root, checkpointPath: cp,
      execute: true, resetCheckpoint: false,
      retryCount: 0, timeoutMs: 5000,
      provider: {} as any, log: () => {}, lockPath: lock,
    });
  } catch { threw = true; }
  report("TASK-89-13 runMigration refused", threw === true);
  report("TASK-89-13 foreign lock preserved", fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(lock); } catch {}
}

// ═══ TASK-89-14: source files unchanged ═══
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t89-src-"));
  fs.mkdirSync(path.join(root, "videos"), { recursive: true });
  fs.writeFileSync(path.join(root, "videos", "keep.mp4"), Buffer.alloc(500, 0x55));
  const before = fs.readFileSync(path.join(root, "videos", "keep.mp4"));
  const cp = path.join(root, "..", `t89-src-${Date.now()}.jsonl`);
  const lock = cp + ".lock";
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999_999_999, hostname: "elsewhere", startedAt: "x",
    sourceDir: root, checkpointPath: cp, ownerToken: "x",
  }));
  try {
    await runMigration({
      sourceDir: root, checkpointPath: cp,
      execute: true, resetCheckpoint: true,
      retryCount: 0, timeoutMs: 5000,
      provider: {} as any, log: () => {}, lockPath: lock,
    });
  } catch { /* expected refusal */ }
  const after = fs.readFileSync(path.join(root, "videos", "keep.mp4"));
  report("TASK-89-14 source unchanged", before.equals(after));
  report("TASK-89-14 source exists", fs.existsSync(path.join(root, "videos", "keep.mp4")));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(lock); } catch {}
}

// ═══ TASK-89-15: static — acquireLock checks hostname before PID ═══
{
  const src = fs.readFileSync("./scripts/r2-migrate.mts", "utf-8");
  const idxHost = src.indexOf("existing.hostname !== os.hostname()");
  const idxPid = src.indexOf("isPidAlive(existing.pid)");
  report("TASK-89-15 hostname check exists", idxHost !== -1);
  report("TASK-89-15 hostname check BEFORE pid check", idxHost !== -1 && idxPid !== -1 && idxHost < idxPid);
}

// ═══ TASK-89-16: static — releaseLock compares ownerToken ═══
{
  const src = fs.readFileSync("./scripts/r2-migrate.mts", "utf-8");
  report("TASK-89-16 releaseLock defined", /export function releaseLock/.test(src));
  report("TASK-89-16 ownerToken compared", /parsed\.ownerToken !== ownerToken/.test(src));
  report("TASK-89-16 no bare unlinkSync in handle.release", !/release:\s*\(\)\s*=>\s*\{[\s\S]{0,200}fs\.unlinkSync\(lockPath\)/.test(src));
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
