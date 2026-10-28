/**
 * KAYAN-6: unit tests for storage upload validation + processing.
 * No HTTP, no DB, no Supabase. Pure functions + injected deps.
 */
import { validateUploadPayload, processUpload } from "../src/routes/storage";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Builders: valid PNG / JPEG magic bytes padded to MIN size (10240).
const makePng = (size = 10240): Buffer => {
  const b = Buffer.alloc(size, 0);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47;
  return b;
};
const makeJpeg = (size = 10240): Buffer => {
  const b = Buffer.alloc(size, 0);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return b;
};

// ─── validateUploadPayload: base64 sanity ─────────────────────────────
report("V1 null body → 400 required", (validateUploadPayload(null) as any).status === 400);
report("V2 empty string → 400 required", (validateUploadPayload({ contentBase64: "" }) as any).status === 400);
report("V3 non-string → 400 required", (validateUploadPayload({ contentBase64: 123 } as any) as any).status === 400);
report("V4 bad length (not %4) → 400 bad payload", (validateUploadPayload({ contentBase64: "AAAAA" }) as any).error === "bad payload");
report("V5 invalid chars → 400 invalid base64", (validateUploadPayload({ contentBase64: "AAAA!!!!" }) as any).error === "invalid base64");
report("V6 payload > 7340032 chars → 400", (validateUploadPayload({ contentBase64: "A".repeat(7340036) }) as any).error === "bad payload");

// ─── validateUploadPayload: size + magic-byte MIME ────────────────────
const tooSmall = Buffer.alloc(10239, 0); tooSmall[0]=0x89; tooSmall[1]=0x50; tooSmall[2]=0x4e; tooSmall[3]=0x47;
report("V7 size < 10KB → 400 size out of range", (validateUploadPayload({ contentBase64: tooSmall.toString("base64") }) as any).error === "size out of range");
const tooLarge = Buffer.alloc(5242881, 0); tooLarge[0]=0x89; tooLarge[1]=0x50; tooLarge[2]=0x4e; tooLarge[3]=0x47;
report("V8 size > 5MB → 400 size out of range", (validateUploadPayload({ contentBase64: tooLarge.toString("base64") }) as any).error === "size out of range");
report("V9 not PNG/JPEG magic → 400", (validateUploadPayload({ contentBase64: Buffer.alloc(10240, 0x42).toString("base64") }) as any).error === "not png or jpeg");
const okPng = validateUploadPayload({ contentBase64: makePng(10240).toString("base64") });
report("V10 valid PNG → ok=true, ext=png, mime=image/png", okPng.ok === true && (okPng as any).ext === "png" && (okPng as any).mime === "image/png");
const okJpeg = validateUploadPayload({ contentBase64: makeJpeg(10240).toString("base64") });
report("V11 valid JPEG → ok=true, ext=jpg, mime=image/jpeg", okJpeg.ok === true && (okJpeg as any).ext === "jpg" && (okJpeg as any).mime === "image/jpeg");

// ─── processUpload: provider + key + write behavior ───────────────────
(async () => {
  const b64 = makePng(10240).toString("base64");
  let wroteKey = ""; let wroteMime = ""; let callCount = 0;
  const deps: any = {
    providerName: "supabase",
    write: async (k: string, _b: Buffer, m: string) => { callCount++; wroteKey = k; wroteMime = m; return "/api/storage/supabase/" + k; },
    makeKey: (ext: string) => "actor-refs/abc-123." + ext,
  };
  const r1 = await processUpload({ contentBase64: b64 }, deps);
  report("P1 provider=supabase → 201 + assetUrl /uploads/...", r1.status === 201 && (r1.json as any).assetUrl === "/uploads/actor-refs/abc-123.png");
  report("P2 key passed matches makeKey", wroteKey === "actor-refs/abc-123.png");
  report("P3 mime passed is image/png", wroteMime === "image/png");
  report("P4 write called exactly once", callCount === 1);
  const r2 = await processUpload({ contentBase64: b64 }, { ...deps, providerName: "local" });
  report("P5 provider=local → 400 requires supabase", r2.status === 400 && (r2.json as any).error === "requires supabase provider");
  const r3 = await processUpload({ contentBase64: b64 }, { ...deps, write: async () => { throw new Error("boom"); } });
  report("P6 write throws → 500 upload failed", r3.status === 500 && (r3.json as any).error === "upload failed");
  const r4 = await processUpload({ contentBase64: b64 }, deps);
  report("P7 assetUrl starts with /uploads/ (Legal-Guard safe)", typeof (r4.json as any).assetUrl === "string" && (r4.json as any).assetUrl.startsWith("/uploads/"));
  report("P8 assetUrl does NOT start with /api/storage/", !String((r4.json as any).assetUrl).startsWith("/api/storage/"));
  console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
  process.exitCode = failed > 0 ? 1 : 0;
})();
