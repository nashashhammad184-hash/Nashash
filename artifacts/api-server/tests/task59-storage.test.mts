import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalProvider } from "../src/lib/storage/localProvider";
import { StorageError, assertSafeKey } from "../src/lib/storage/types";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t59-"));
const provider = new LocalProvider(TMP);

// ═══ write + read roundtrip ═══
{
  const data = Buffer.from("hello-storage-" + Date.now());
  const url = await provider.write("audio/test.mp3", data, "audio/mpeg");
  report("write returns /uploads/ URL", url === "/uploads/audio/test.mp3", url);
  report("exists after write", (await provider.exists("audio/test.mp3")) === true);
  const read = await provider.read("audio/test.mp3");
  report("read matches write", read.equals(data));
}

// ═══ large file (5 MB) ═══
{
  const big = Buffer.alloc(5 * 1024 * 1024, 0xab);
  await provider.write("videos/big.mp4", big, "video/mp4");
  const st = fs.statSync(path.join(TMP, "videos/big.mp4"));
  report("large file written (5MB)", st.size === big.length, `${st.size} vs ${big.length}`);
  const rd = await provider.read("videos/big.mp4");
  report("large file read matches", rd.length === big.length && rd[0] === 0xab);
}

// ═══ delete + idempotency ═══
{
  await provider.write("temp/del.txt", Buffer.from("x"));
  await provider.delete("temp/del.txt");
  report("delete removes file", (await provider.exists("temp/del.txt")) === false);
  // delete again — no throw
  let ok = true;
  try { await provider.delete("temp/del.txt"); } catch { ok = false; }
  report("delete missing → no-op", ok);
}

// ═══ read missing → NOT_FOUND ═══
{
  let code = "";
  try { await provider.read("missing/nothing.txt"); } catch (e: any) { code = e?.code; }
  report("read missing → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ localPath for existing / missing ═══
{
  await provider.write("videos/lp.mp4", Buffer.from("data"));
  const lp = await provider.localPath("videos/lp.mp4");
  report("localPath returns absolute path", path.isAbsolute(lp) && fs.existsSync(lp));
  let code = "";
  try { await provider.localPath("missing/nope.mp4"); } catch (e: any) { code = e?.code; }
  report("localPath missing → NOT_FOUND", code === "NOT_FOUND", code);
}

// ═══ publicUrl shape ═══
{
  report("publicUrl", provider.publicUrl("audio/x.mp3") === "/uploads/audio/x.mp3");
}

// ═══ path traversal protection ═══
{
  const bads = [
    "../etc/passwd",
    "audio/../../etc/passwd",
    "/abs/path",
    "audio/./x",
    "a//b",
    "audio\\x",
    "x\0y",
    "",
    "..",
  ];
  let caught = 0;
  for (const b of bads) {
    try { assertSafeKey(b); } catch { caught++; }
  }
  report("all unsafe keys rejected", caught === bads.length, `${caught}/${bads.length}`);
  // Valid keys
  let ok = true;
  try {
    assertSafeKey("audio/x.mp3");
    assertSafeKey("videos/a/b/c.mp4");
  } catch { ok = false; }
  report("valid nested keys accepted", ok);
}

// ═══ write non-Buffer → error ═══
{
  let code = "";
  try { await provider.write("audio/x.mp3", "not-a-buffer" as any); } catch (e: any) { code = e?.code; }
  report("write non-Buffer → INVALID_DATA", code === "INVALID_DATA", code);
}

// ═══ cleanup is no-op ═══
{
  await provider.write("renders/r.mp4", Buffer.from("r"));
  const lp = await provider.localPath("renders/r.mp4");
  await provider.cleanup(lp);
  report("cleanup does not delete local file", fs.existsSync(lp));
}

// cleanup test dir
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
