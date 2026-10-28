/**
 * KAYAN-6: HTTP integration test for /api/storage/upload.
 * Real Express + fetch. Mock StorageProvider. No DB, no Supabase.
 */
import express from "express";
import cookieParser from "cookie-parser";
import storageRouter from "../src/routes/storage";
import { originGuard } from "../src/lib/securityMiddleware";
import { _resetStorageForTests } from "../src/lib/storage/index";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};
const makePng = (size = 10240): Buffer => { const b = Buffer.alloc(size, 0); b[0]=0x89;b[1]=0x50;b[2]=0x4e;b[3]=0x47; return b; };

const mockProvider: any = {
  name: "supabase",
  write: async (_k: string, _b: Buffer, _m?: string) => "/api/storage/supabase/_k",
  read: async () => Buffer.alloc(0),
  exists: async () => true,
  delete: async () => {},
  localPath: async () => "/tmp/_x",
  cleanup: async () => {},
  publicUrl: (k: string) => "/api/storage/supabase/" + k,
};
(async () => {
  const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
  process.env.PRODUCTION_API_TOKEN = TOKEN;
  process.env.NODE_ENV = "test";
  _resetStorageForTests(mockProvider);
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(cookieParser());
  app.use("/api", originGuard);
  app.use("/api", storageRouter);
  const server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  const addr = server.address() as any;
  const base = "http://127.0.0.1:" + addr.port;
  const validB64 = makePng(10240).toString("base64");
  const auth = { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN };
  const r1 = await fetch(base + "/api/storage/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentBase64: validB64 }) });
  report("H1 no auth → 401", r1.status === 401);
  const r2 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({ contentBase64: "AAAA!!!!" }) });
  report("H2 bad base64 → 400", r2.status === 400 && (await r2.json() as any).error === "invalid base64");
  const small = Buffer.alloc(10239, 0); small[0]=0x89;small[1]=0x50;small[2]=0x4e;small[3]=0x47;
  const r3 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({ contentBase64: small.toString("base64") }) });
  report("H3 size < 10KB → 400", r3.status === 400 && (await r3.json() as any).error === "size out of range");
  const r4 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({ contentBase64: validB64 }) });
  const j4 = await r4.json() as any;
  report("H4 valid PNG + Bearer → 201", r4.status === 201);
  report("H5 assetUrl starts /uploads/actor-refs/", typeof j4.assetUrl === "string" && j4.assetUrl.startsWith("/uploads/actor-refs/"));
  report("H6 assetUrl ends .png", typeof j4.assetUrl === "string" && j4.assetUrl.endsWith(".png"));
  const r5 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({}) });
  report("H7 missing body → 400", r5.status === 400);
  _resetStorageForTests({ ...mockProvider, name: "local" });
  const r6 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({ contentBase64: validB64 }) });
  report("H8 provider=local → 400 requires supabase", r6.status === 400 && (await r6.json() as any).error === "requires supabase provider");
  _resetStorageForTests({ ...mockProvider, write: async () => { throw new Error("boom"); } });
  const r7 = await fetch(base + "/api/storage/upload", { method: "POST", headers: auth, body: JSON.stringify({ contentBase64: validB64 }) });
  report("H9 write throws → 500", r7.status === 500);
  _resetStorageForTests(mockProvider);
  const r8 = await fetch(base + "/api/storage/upload", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer wrong-token" }, body: JSON.stringify({ contentBase64: validB64 }) });
  report("H10 wrong Bearer → 401", r8.status === 401);
  server.close();
  console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
  process.exitCode = failed > 0 ? 1 : 0;
})();
