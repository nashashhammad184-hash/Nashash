import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runMigration,
  resetCheckpoint,
  acquireLock,
  withRetry,
  withCancelableTimeout,
  loadCheckpoint,
  sha256OfFile,
} from "../scripts/r2-migrate.mts";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

function mkFixture(): { root: string; cp: string; lock: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t87-"));
  const cp = path.join(root, "..", `t87-cp-${Date.now()}-${Math.random().toString(36).slice(2,7)}.jsonl`);
  const lock = cp + ".lock";
  for (const sub of ["videos", "audio", "voice"]) fs.mkdirSync(path.join(root, sub), { recursive: true });
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(1000, 0xab));
  fs.writeFileSync(path.join(root, "audio", "b.mp3"), Buffer.alloc(500, 0xcd));
  fs.writeFileSync(path.join(root, "voice", "c.mp3"), Buffer.alloc(700, 0xef));
  return { root, cp, lock };
}

interface MockProvider {
  name: string;
  write: (k: string, b: Buffer, ct?: string) => Promise<string>;
  writeFromFile?: (p: string, k: string, ct?: string, signal?: AbortSignal) => Promise<string>;
  read: (k: string) => Promise<Buffer>;
  exists: (k: string) => Promise<boolean>;
  delete: (k: string) => Promise<void>;
  localPath: (k: string) => Promise<string>;
  cleanup: (p: string) => Promise<void>;
  publicUrl: (k: string) => string;
}

function mkMock(tmpDir: string, opts: { hangKeys?: Set<string>; corruptKeys?: Set<string> } = {}): MockProvider {
  const storage = new Map<string, Buffer>();
  const hangs = opts.hangKeys ?? new Set();
  const corrupt = opts.corruptKeys ?? new Set();
  return {
    name: "r2",
    async write(k, b) { storage.set(k, Buffer.from(b)); return `/api/storage/r2/${k}`; },
    async writeFromFile(p, k, _ct, signal) {
      if (hangs.has(k)) {
        // hang until signal aborts
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 10_000);
          if (signal) signal.addEventListener("abort", () => { clearTimeout(t); const e: any = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
        });
      }
      storage.set(k, fs.readFileSync(p));
      return `/api/storage/r2/${k}`;
    },
    async read(k) { const b = storage.get(k); if (!b) throw new Error("NOT_FOUND"); return Buffer.from(b); },
    async exists(k) { return storage.has(k); },
    async delete(k) { storage.delete(k); },
    async localPath(k) {
      const b = storage.get(k);
      if (!b) throw new Error("NOT_FOUND");
      const p = path.join(tmpDir, `dl_${Math.random().toString(36).slice(2)}_${path.basename(k)}`);
      fs.writeFileSync(p, corrupt.has(k) ? Buffer.alloc(b.length, 0xff) : b);
      return p;
    },
    async cleanup(p) { try { fs.unlinkSync(p); } catch {} },
    publicUrl(k) { return `/api/storage/r2/${k}`; },
  };
}

// ═══ TASK-87-01: resetCheckpoint refuses file inside sourceDir ═══
{
  const { root } = mkFixture();
  const victim = path.join(root, "videos", "a.mp4");
  const before = fs.statSync(victim).size;
  const r = resetCheckpoint(victim, root);
  report("TASK-87-01 refuses file inside sourceDir", r.ok === false, JSON.stringify(r));
  report("TASK-87-01 victim still exists", fs.existsSync(victim) && fs.statSync(victim).size === before);
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-02: resetCheckpoint refuses directory ═══
{
  const { root } = mkFixture();
  const r = resetCheckpoint(root, undefined);
  report("TASK-87-02 refuses directory", r.ok === false);
  report("TASK-87-02 dir still exists", fs.existsSync(root));
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-03: resetCheckpoint deletes a legit checkpoint file ═══
{
  const { cp } = mkFixture();
  fs.writeFileSync(cp, "x");
  const r = resetCheckpoint(cp, undefined);
  report("TASK-87-03 deletes checkpoint", r.ok === true && (r as any).deleted === true, JSON.stringify(r));
  report("TASK-87-03 file gone", !fs.existsSync(cp));
}

// ═══ TASK-87-04: resetCheckpoint tolerates missing checkpoint ═══
{
  const p = path.join(os.tmpdir(), `t87-missing-${Date.now()}.jsonl`);
  const r = resetCheckpoint(p, undefined);
  report("TASK-87-04 missing → no-op ok", r.ok === true && (r as any).deleted === false, JSON.stringify(r));
}

// ═══ TASK-87-05: reset via runMigration refuses mp4 target ═══
{
  const { root } = mkFixture();
  const victim = path.join(root, "videos", "a.mp4");
  const mock = mkMock(root);
  let threw = false;
  try {
    await runMigration({
      sourceDir: root, checkpointPath: victim,
      execute: true, resetCheckpoint: true,
      retryCount: 0, timeoutMs: 5000,
      provider: mock, log: () => {}, lockPath: null,
    });
  } catch { threw = true; }
  report("TASK-87-05 execute+reset on mp4 refuses", threw);
  report("TASK-87-05 victim preserved", fs.existsSync(victim) && fs.statSync(victim).size === 1000);
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-06: dry-run + reset → no delete ═══
{
  const { root, cp } = mkFixture();
  fs.writeFileSync(cp, "existing-content");
  const mock = mkMock(root);
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: false, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: null,
  });
  report("TASK-87-06 dry-run+reset keeps file", fs.existsSync(cp));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-87-07: retry semantics (maxRetries=N → N+1 attempts) ═══
{
  for (const N of [0, 1, 3]) {
    let calls = 0;
    try { await withRetry(async () => { calls++; throw new Error("x"); }, N, 5, () => {}); } catch {}
    report(`TASK-87-07 retry N=${N} → attempts=${N+1}`, calls === N + 1, `calls=${calls}`);
  }
}

// ═══ TASK-87-08: withCancelableTimeout aborts hanging op ═══
{
  const controllerSeen: AbortSignal[] = [];
  const start = Date.now();
  let code = "";
  try {
    await withCancelableTimeout(
      (signal) => {
        controllerSeen.push(signal);
        return new Promise<void>((_, rej) => {
          signal.addEventListener("abort", () => { const e: any = new Error("aborted"); e.name = "AbortError"; rej(e); }, { once: true });
        });
      },
      200, "test-hang"
    );
  } catch (e: any) { code = e?.code; }
  const elapsed = Date.now() - start;
  report("TASK-87-08 aborts within bound", elapsed < 1000, `elapsed=${elapsed}ms`);
  report("TASK-87-08 TIMEOUT code", code === "TIMEOUT", code);
  report("TASK-87-08 signal provided", controllerSeen.length === 1 && controllerSeen[0] instanceof AbortSignal);
  report("TASK-87-08 signal.aborted", controllerSeen[0].aborted === true);
}

// ═══ TASK-87-09: timeout in runMigration → file fails, no checkpoint, no retry ═══
{
  const { root, cp } = mkFixture();
  const hangs = new Set<string>(["videos/a.mp4"]);
  const mock = mkMock(root, { hangKeys: hangs });
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 5, timeoutMs: 300,
    provider: mock, log: () => {}, lockPath: null,
  });
  report("TASK-87-09 a.mp4 failed", s.failedKeys.includes("videos/a.mp4"), JSON.stringify(s.failedKeys));
  const cpData = fs.existsSync(cp) ? fs.readFileSync(cp, "utf-8") : "";
  report("TASK-87-09 a.mp4 not in checkpoint", !cpData.includes("videos/a.mp4"));
  // Other 2 files should have succeeded
  report("TASK-87-09 other files uploaded", s.uploaded === 2, `uploaded=${s.uploaded}`);
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-87-10: concurrent lock prevents second run ═══
{
  const { root, cp, lock } = mkFixture();
  const mock = mkMock(root);
  const r1 = acquireLock(lock, { sourceDir: root, checkpointPath: cp });
  report("TASK-87-10 first lock acquires", r1.ok === true);
  const r2 = acquireLock(lock, { sourceDir: root, checkpointPath: cp });
  report("TASK-87-10 second lock refused", r2.ok === false);
  report("TASK-87-10 error mentions running", /already running/i.test((r2 as any).error ?? ""));
  if (r1.ok) r1.handle.release();
  report("TASK-87-10 lock released → file gone", !fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-11: runMigration acquires + releases lock ═══
{
  const { root, cp, lock } = mkFixture();
  const mock = mkMock(root);
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: lock,
  });
  report("TASK-87-11 lock released after run", !fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-87-12: runMigration with active lock → refuses ═══
{
  const { root, cp, lock } = mkFixture();
  const held = acquireLock(lock, { sourceDir: root, checkpointPath: cp });
  const mock = mkMock(root);
  let threw = false;
  try {
    await runMigration({
      sourceDir: root, checkpointPath: cp,
      execute: true, resetCheckpoint: false,
      retryCount: 0, timeoutMs: 5000,
      provider: mock, log: () => {}, lockPath: lock,
    });
  } catch { threw = true; }
  report("TASK-87-12 refuses when lock held", threw);
  if (held.ok) held.handle.release();
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-13 (updated by TASK-89): stale lock on DIFFERENT host → refuse ═══
{
  const { cp, lock, root } = mkFixture();
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999_999_999, startedAt: new Date().toISOString(),
    hostname: "some-other-host", sourceDir: root, checkpointPath: cp,
    ownerToken: "other-token",
  }));
  const r = acquireLock(lock, { sourceDir: root, checkpointPath: cp });
  report("TASK-87-13 foreign-host lock refused", r.ok === false, JSON.stringify(r));
  report("TASK-87-13 lock NOT deleted", fs.existsSync(lock));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(lock); } catch {}
}

// ═══ TASK-87-14: corrupt lock → manual intervention ═══
{
  const { root, cp, lock } = mkFixture();
  fs.writeFileSync(lock, "not-json-at-all");
  const r = acquireLock(lock, { sourceDir: root, checkpointPath: cp });
  report("TASK-87-14 corrupt lock refused", r.ok === false);
  report("TASK-87-14 error mentions manual", /manual/i.test((r as any).error ?? ""), (r as any).error);
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TASK-87-15: SHA-256 verified end-to-end still works ═══
{
  const { root, cp } = mkFixture();
  const mock = mkMock(root);
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: null,
  });
  report("TASK-87-15 all 3 uploaded", s.uploaded === 3, `uploaded=${s.uploaded}`);
  report("TASK-87-15 no failures", s.failed === 0);
  const cpData = fs.readFileSync(cp, "utf-8").trim().split("\n");
  report("TASK-87-15 3 checkpoint lines", cpData.length === 3);
  for (const line of cpData) {
    const j = JSON.parse(line);
    report(`TASK-87-15 ${j.key} has valid sha256`, typeof j.sha256 === "string" && j.sha256.length === 64);
  }
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-87-16: corrupt remote → fail, no checkpoint ═══
{
  const { root, cp } = mkFixture();
  const mock = mkMock(root, { corruptKeys: new Set(["videos/a.mp4"]) });
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: null,
  });
  report("TASK-87-16 corrupt file failed", s.failedKeys.includes("videos/a.mp4"));
  const cpData = fs.existsSync(cp) ? fs.readFileSync(cp, "utf-8") : "";
  report("TASK-87-16 corrupt not in checkpoint", !cpData.includes("videos/a.mp4"));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TASK-87-17: source files untouched ═══
{
  const { root, cp } = mkFixture();
  const before = fs.readFileSync(path.join(root, "videos", "a.mp4"));
  const mock = mkMock(root);
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {}, lockPath: null,
  });
  const after = fs.readFileSync(path.join(root, "videos", "a.mp4"));
  report("TASK-87-17 source byte-identical", before.equals(after));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
