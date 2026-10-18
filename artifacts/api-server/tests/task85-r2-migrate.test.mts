import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  runMigration,
  sha256OfFile,
  loadCheckpoint,
  appendCheckpoint,
  isExcluded,
  withTimeout,
  withRetry,
} from "../scripts/r2-migrate.mts";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// ─── Fixture builder ───
function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t85-"));
  for (const sub of ["videos", "audio", "voice", "renders", "subtitles"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(1000, 0xab));
  fs.writeFileSync(path.join(root, "audio", "b.mp3"), Buffer.alloc(500, 0xcd));
  fs.writeFileSync(path.join(root, "voice", "c.mp3"), Buffer.alloc(700, 0xef));
  fs.writeFileSync(path.join(root, "renders", "d.mp4"), Buffer.alloc(2000, 0x12));
  fs.writeFileSync(path.join(root, "subtitles", "e.srt"), Buffer.from("1\n00:00:00,000 --> 00:00:05,000\nhi\n"));
  fs.writeFileSync(path.join(root, "renders", "kayan-studio-app.AppImage"), Buffer.alloc(5000));
  fs.writeFileSync(path.join(root, "renders", "install.html"), Buffer.from("<html></html>"));
  return root;
}

// ─── Mock provider ───
interface MockProvider {
  name: string;
  write: (key: string, buf: Buffer, ct?: string) => Promise<string>;
  writeFromFile?: (p: string, key: string, ct?: string) => Promise<string>;
  read: (key: string) => Promise<Buffer>;
  exists: (key: string) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
  localPath: (key: string) => Promise<string>;
  cleanup: (p: string) => Promise<void>;
  publicUrl: (key: string) => string;
}

function makeMockProvider(opts: {
  failFirstN?: Map<string, number>;
  corruptKeys?: Set<string>;
  timeoutKeys?: Set<string>;
  tmpDir: string;
}): MockProvider {
  const storage = new Map<string, Buffer>();
  const failCounts = opts.failFirstN ?? new Map();
  const corrupt = opts.corruptKeys ?? new Set<string>();
  const timeout = opts.timeoutKeys ?? new Set<string>();
  const downloaded: string[] = [];

  return {
    name: "r2",
    async write(key, buf) {
      const n = failCounts.get(key) ?? 0;
      if (n > 0) {
        failCounts.set(key, n - 1);
        throw new Error(`mock fail ${key}`);
      }
      storage.set(key, Buffer.from(buf));
      return `/api/storage/r2/${key}`;
    },
    async writeFromFile(localPath, key) {
      const n = failCounts.get(key) ?? 0;
      if (n > 0) {
        failCounts.set(key, n - 1);
        throw new Error(`mock fail ${key}`);
      }
      if (timeout.has(key)) {
        // Simulate a hanging op.
        await new Promise((r) => setTimeout(r, 5000));
      }
      storage.set(key, fs.readFileSync(localPath));
      return `/api/storage/r2/${key}`;
    },
    async read(key) {
      const b = storage.get(key);
      if (!b) throw new Error("NOT_FOUND");
      return Buffer.from(b);
    },
    async exists(key) {
      return storage.has(key);
    },
    async delete(key) { storage.delete(key); },
    async localPath(key) {
      const b = storage.get(key);
      if (!b) throw new Error("NOT_FOUND");
      const p = path.join(opts.tmpDir, `dl_${crypto.randomUUID()}_${path.basename(key)}`);
      fs.writeFileSync(p, corrupt.has(key) ? Buffer.alloc(b.length, 0xff) : b);
      downloaded.push(p);
      return p;
    },
    async cleanup(p) {
      try { fs.unlinkSync(p); } catch {}
    },
    publicUrl(key) { return `/api/storage/r2/${key}`; },
  };
}

// ═══ TEST-85-01: voice/ included in default subdirs ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp-${Date.now()}.jsonl`);
  const mock = makeMockProvider({ tmpDir: root });
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  // Expect: 5 files (a, b, c, d, e.srt) — .AppImage + .html excluded
  report("TASK-85-01 voice/ included (c.mp3 uploaded)", s.uploaded === 5, `uploaded=${s.uploaded}`);
  const cpData = fs.readFileSync(cp, "utf-8");
  report("TASK-85-01 voice/c.mp3 in checkpoint", cpData.includes("voice/c.mp3"));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-02: checkpoint resume — second run skips everything ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp2-${Date.now()}.jsonl`);
  const mock = makeMockProvider({ tmpDir: root });

  const s1 = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  const s2 = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: false,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  report("TASK-85-02 first run uploaded 5", s1.uploaded === 5, `s1=${s1.uploaded}`);
  report("TASK-85-02 second run uploaded 0", s2.uploaded === 0, `s2=${s2.uploaded}`);
  report("TASK-85-02 second run skipped 5", s2.skipped === 5, `skipped=${s2.skipped}`);
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-03: source changed after checkpoint → re-upload ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp3-${Date.now()}.jsonl`);
  const mock = makeMockProvider({ tmpDir: root });

  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  // Modify file
  fs.writeFileSync(path.join(root, "videos", "a.mp4"), Buffer.alloc(1000, 0x77));
  const s2 = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: false,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  report("TASK-85-03 changed file re-uploaded", s2.uploaded === 1, `uploaded=${s2.uploaded}`);
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-04: upload fails → retry → succeeds ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp4-${Date.now()}.jsonl`);
  // Fail "videos/a.mp4" twice then succeed (retry 3 means 1 + 2 retries min).
  const fails = new Map<string, number>([["videos/a.mp4", 2]]);
  const mock = makeMockProvider({ tmpDir: root, failFirstN: fails });

  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 3, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  report("TASK-85-04 retry succeeded for a.mp4", s.failed === 0, `failed=${s.failed}`);
  report("TASK-85-04 all 5 uploaded", s.uploaded === 5, `uploaded=${s.uploaded}`);
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-05: timeout aborts hanging upload ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp5-${Date.now()}.jsonl`);
  const timeouts = new Set<string>(["videos/a.mp4"]);
  const mock = makeMockProvider({ tmpDir: root, timeoutKeys: timeouts });
  const start = Date.now();
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 500, // very short
    provider: mock, log: () => {},
  });
  const elapsed = Date.now() - start;
  report("TASK-85-05 timeout triggered", elapsed < 3000, `elapsed=${elapsed}ms`);
  report("TASK-85-05 a.mp4 failed", s.failedKeys.includes("videos/a.mp4"), JSON.stringify(s.failedKeys));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-06: SHA-256 mismatch → fail, no checkpoint entry ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp6-${Date.now()}.jsonl`);
  const corrupt = new Set<string>(["videos/a.mp4"]);
  const mock = makeMockProvider({ tmpDir: root, corruptKeys: corrupt });

  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  report("TASK-85-06 corrupt file failed", s.failedKeys.includes("videos/a.mp4"), JSON.stringify(s.failedKeys));
  const cpData = fs.existsSync(cp) ? fs.readFileSync(cp, "utf-8") : "";
  report("TASK-85-06 a.mp4 NOT in checkpoint", !cpData.includes("videos/a.mp4"));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-07: streaming hash — large file without full buffer ═══
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t85-large-"));
  const big = path.join(root, "big.mp4");
  // 20 MB file
  fs.writeFileSync(big, Buffer.alloc(20 * 1024 * 1024, 0x33));
  const memBefore = process.memoryUsage().heapUsed;
  const r = await sha256OfFile(big);
  const memAfter = process.memoryUsage().heapUsed;
  const deltaMB = (memAfter - memBefore) / (1024 * 1024);
  report("TASK-85-07 hash correct size", r.size === 20 * 1024 * 1024, `${r.size}`);
  report("TASK-85-07 heap delta < 5 MB (streaming)", Math.abs(deltaMB) < 5, `delta=${deltaMB.toFixed(2)}MB`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TEST-85-08: source files preserved after migration ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp8-${Date.now()}.jsonl`);
  const mock = makeMockProvider({ tmpDir: root });
  const beforeA = fs.readFileSync(path.join(root, "videos", "a.mp4"));
  await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: true, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  const afterA = fs.readFileSync(path.join(root, "videos", "a.mp4"));
  report("TASK-85-08 source files preserved", beforeA.equals(afterA));
  report("TASK-85-08 all 7 files still exist",
    fs.existsSync(path.join(root, "videos", "a.mp4")) &&
    fs.existsSync(path.join(root, "audio", "b.mp3")) &&
    fs.existsSync(path.join(root, "voice", "c.mp3")) &&
    fs.existsSync(path.join(root, "renders", "d.mp4")) &&
    fs.existsSync(path.join(root, "subtitles", "e.srt")));
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.unlinkSync(cp); } catch {}
}

// ═══ TEST-85-09: dry-run does not upload, does not write checkpoint ═══
{
  const root = makeFixture();
  const cp = path.join(root, "..", `t85-cp9-${Date.now()}.jsonl`);
  let writeCallCount = 0;
  const mock = makeMockProvider({ tmpDir: root });
  const origWrite = mock.writeFromFile!;
  mock.writeFromFile = async (p, k, ct) => { writeCallCount++; return origWrite(p, k, ct); };
  const s = await runMigration({
    sourceDir: root, checkpointPath: cp,
    execute: false, resetCheckpoint: true,
    retryCount: 0, timeoutMs: 5000,
    provider: mock, log: () => {},
  });
  report("TASK-85-09 dry-run uploaded 0", s.uploaded === 0);
  report("TASK-85-09 dry-run write calls = 0", writeCallCount === 0, `writes=${writeCallCount}`);
  report("TASK-85-09 dry-run no checkpoint written", !fs.existsSync(cp));
  fs.rmSync(root, { recursive: true, force: true });
}

// ═══ TEST-85-10: checkpoint tolerance to corrupt lines ═══
{
  const cp = path.join(os.tmpdir(), `t85-cp10-${Date.now()}.jsonl`);
  fs.writeFileSync(cp, [
    `{"key":"a","size":1,"sha256":"x","at":""}`,
    `NOT VALID JSON`,
    `{"key":"b","size":2,"sha256":"y","at":""}`,
    `{"key":"c"`, // incomplete
    ``,
  ].join("\n"));
  const m = loadCheckpoint(cp);
  report("TASK-85-10 corrupt lines skipped", m.size === 2, `size=${m.size}`);
  report("TASK-85-10 valid entries loaded", m.has("a") && m.has("b"));
  fs.unlinkSync(cp);
}

// ═══ TEST-85-11: withTimeout rejects on hang ═══
{
  let threw = false;
  try {
    await withTimeout(new Promise((r) => setTimeout(() => r(1), 10000)), 100, "test");
  } catch (e: any) {
    threw = e?.message?.includes("TIMEOUT");
  }
  report("TASK-85-11 withTimeout rejects with TIMEOUT", threw);
}

// ═══ TEST-85-12: withRetry bounded ═══
{
  let calls = 0;
  let threw = false;
  try {
    await withRetry(async () => { calls++; throw new Error("always"); }, 2, 10, () => {});
  } catch {
    threw = true;
  }
  report("TASK-85-12 withRetry exhausted", threw);
  report("TASK-85-12 total calls = 3 (1 + 2 retries)", calls === 3, `calls=${calls}`);
}

// ═══ TEST-85-13: isExcluded rejects appimage/html ═══
{
  report("TASK-85-13 .AppImage excluded", isExcluded("foo.AppImage") === true);
  report("TASK-85-13 .appimage excluded", isExcluded("foo.appimage") === true);
  report("TASK-85-13 .html excluded", isExcluded("x.html") === true);
  report("TASK-85-13 .htm excluded", isExcluded("x.htm") === true);
  report("TASK-85-13 .mp4 accepted", isExcluded("x.mp4") === false);
  report("TASK-85-13 .mp3 accepted", isExcluded("x.mp3") === false);
}

// ═══ TEST-85-14: checkpoint in DEFAULT_SUBDIRS does NOT include temp ═══
{
  const src = fs.readFileSync("./scripts/r2-migrate.mts", "utf-8");
  report("TASK-85-14 voice in defaults", /"voice"/.test(src));
  const subdirBlock = /DEFAULT_SUBDIRS\s*=\s*\[([\s\S]{0,300})\]/m.exec(src)?.[1] ?? "";
  report("TASK-85-14 temp NOT in defaults", !/temp/.test(subdirBlock), subdirBlock.replace(/\s+/g, " "));
}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
