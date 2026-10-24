/**
 * KAYAN-CINEMA-16: behavioral tests for actor reference resolution.
 * Uses _setActorRefDeps to inject fake DB + storage. NO real DB, NO real
 * storage, NO paid provider calls.
 */
import fs from "node:fs";
import { getTableName } from "drizzle-orm";
import path from "node:path";
import {
  resolveActorReference,
  detectImageMime,
  _setActorRefDeps,
  _resetActorRefDeps,
  MIN_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
} from "../src/lib/actorReference.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

// ─── Fixtures ──────────────────────────────────────────────────
const tmpDir = "/tmp/cinema-16-test";
fs.mkdirSync(tmpDir, { recursive: true });

function makePng(size: number): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; // PNG magic
  return buf;
}
function makeJpeg(size: number): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; // JPEG magic
  return buf;
}

const pngPath = path.join(tmpDir, "ref.png");
const largeJpegPath = path.join(tmpDir, "large.jpg");
fs.writeFileSync(pngPath, makePng(50 * 1024)); // 50 KB
fs.writeFileSync(largeJpegPath, makeJpeg(6 * 1024 * 1024)); // 6 MB

// ─── Mock DB ────────────────────────────────────────────────────
type Row = Record<string, any>;
let linkRows: Row[] = [];
let actorRows: Row[] = [];

const fakeDb: any = {
  select: (_cols?: any) => ({
    from: (table: any) => {
      const name = getTableName(table);
      const which = name === "project_actors" ? "link"
        : name === "actors" ? "actor" : "unknown";
      return {
        where: (_cond: any) => ({
          limit: async (_n: number) => {
            if (which === "link") return linkRows;
            if (which === "actor") return actorRows;
            return [];
          },
        }),
      };
    },
  }),
};

// ─── Mock storage ───────────────────────────────────────────────
function mockStorage(filePath: string | null, opts: { cleanupCalled?: { v: boolean } } = {}) {
  return {
    resolveLocal: async (_url: string) => {
      if (!filePath) throw new Error("simulated resolve failure");
      return {
        path: filePath,
        wasRemote: false,
        cleanup: async () => { if (opts.cleanupCalled) opts.cleanupCalled.v = true; },
      };
    },
  };
}

const stubDeps = (filePath: string | null, cleanupFlag?: { v: boolean }) => ({
  getDb: () => fakeDb,
  resolveLocal: mockStorage(filePath, { cleanupCalled: cleanupFlag }).resolveLocal,
  readFile: (p: string) => fs.readFileSync(p),
  statFile: (p: string) => fs.statSync(p),
});

// ─── A. No actor → t2v passthrough ──────────────────────────────
{
  _setActorRefDeps(stubDeps(null));
  const r = await resolveActorReference({ actorId: undefined, projectId: 1 });
  check("A1 no actor → ok", r.ok === true);
  check("A2 no actor → task=t2v", r.ok && r.task === "t2v");
  check("A3 no actor → ref=null", r.ok && r.referenceImageBase64 === null);
  check("A4 no actor → actorId=null", r.ok && r.actorId === null);
}

// ─── B. No actor + explicit ref → i2v ──────────────────────────
{
  _setActorRefDeps(stubDeps(null));
  const r = await resolveActorReference({
    actorId: undefined, projectId: 1,
    explicitReferenceImageBase64: "x".repeat(100),
  });
  check("B1 explicit ref → ok", r.ok === true);
  check("B2 explicit ref → task=i2v", r.ok && r.task === "i2v");
  check("B3 explicit ref → ref preserved", r.ok && r.referenceImageBase64 === "x".repeat(100));
  check("B4 explicit ref → source=explicit", r.ok && r.source === "explicit");
}

// ─── C. Invalid actorId format ─────────────────────────────────
{
  _setActorRefDeps(stubDeps(null));
  const r = await resolveActorReference({ actorId: "abc", projectId: 1 });
  check("C1 invalid actorId → 400", r.ok === false && r.status === 400);
}

// ─── D. Actor not linked to project → 403 ──────────────────────
{
  linkRows = []; // no link
  actorRows = [{ id: 42, name: "Test Actor", canonicalFaceImagePath: "/x.png" }];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("D1 unlinked actor → 403", r.ok === false && r.status === 403);
  check("D2 error mentions link", !r.ok && /not linked/i.test(r.error));
}

// ─── E. Linked actor but no actor row → 404 ────────────────────
{
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = []; // missing
  _setActorRefDeps(stubDeps(pngPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("E1 missing actor → 404", r.ok === false && r.status === 404);
}

// ─── F. Actor with no reference image → 400 ────────────────────
{
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "No Image", canonicalFaceImagePath: null, imageUrl: null }];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("F1 no image → 400", r.ok === false && r.status === 400);
}

// ─── G. Happy path: PNG ────────────────────────────────────────
{
  const cleanupFlag = { v: false };
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/uploads/x.png" }];
  _setActorRefDeps(stubDeps(pngPath, cleanupFlag));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("G1 happy PNG → ok", r.ok === true);
  check("G2 happy PNG → task=i2v", r.ok && r.task === "i2v");
  check("G3 happy PNG → base64 present", r.ok && !!r.referenceImageBase64 && r.referenceImageBase64!.length > 0);
  check("G4 happy PNG → actorId=42", r.ok && r.actorId === 42);
  check("G5 happy PNG → source=actor", r.ok && r.source === "actor");
  check("G6 happy PNG → cleanup called", cleanupFlag.v === true);
}

// ─── H. Image too small → 400 ──────────────────────────────────
{
  const tinyPath = path.join(tmpDir, "tiny.png");
  fs.writeFileSync(tinyPath, makePng(100)); // 100 bytes
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/x.png" }];
  _setActorRefDeps(stubDeps(tinyPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("H1 too small → 400", r.ok === false && r.status === 400);
}

// ─── I. Image too large → 400 ──────────────────────────────────
{
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/x.jpg" }];
  _setActorRefDeps(stubDeps(largeJpegPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("I1 too large → 400", r.ok === false && r.status === 400);
}

// ─── J. Not PNG/JPEG → 400 ────────────────────────────────────
{
  const badPath = path.join(tmpDir, "bad.bin");
  fs.writeFileSync(badPath, Buffer.alloc(50 * 1024, 0x41)); // "AAAA..."
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/x.bin" }];
  _setActorRefDeps(stubDeps(badPath));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("J1 bad magic → 400", r.ok === false && r.status === 400);
}

// ─── K. Storage resolve fails → 500 (no path leak) ─────────────
{
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/x.png" }];
  _setActorRefDeps(stubDeps(null));
  const r = await resolveActorReference({ actorId: 42, projectId: 1 });
  check("K1 resolve fail → 500", r.ok === false && r.status === 500);
  check("K2 error hides internal path", !r.ok && !/\/tmp|uploads|:\/\//.test(r.error));
}

// ─── L. detectImageMime ───────────────────────────────────────
{
  check("L1 PNG magic", detectImageMime(makePng(100)) === "image/png");
  check("L2 JPEG magic", detectImageMime(makeJpeg(100)) === "image/jpeg");
  check("L3 empty → null", detectImageMime(Buffer.alloc(2)) === null);
  check("L4 random → null", detectImageMime(Buffer.from("hello")) === null);
}

// ─── M. Explicit ref + actor → prefers actor's image ─────────
{
  linkRows = [{ projectId: 1, actorId: 42 }];
  actorRows = [{ id: 42, name: "Jana", canonicalFaceImagePath: "/x.png" }];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await resolveActorReference({
    actorId: 42, projectId: 1,
    explicitReferenceImageBase64: "explicit".repeat(10),
  });
  check("M1 actor overrides explicit", r.ok && r.source === "actor");
  check("M2 ref is from file (not explicit)", r.ok && r.referenceImageBase64 !== "explicit".repeat(10));
}

// ─── N. Constants sanity ──────────────────────────────────────
{
  check("N1 MIN_IMAGE_BYTES = 10KB", MIN_IMAGE_BYTES === 10 * 1024);
  check("N2 MAX_IMAGE_BYTES = 5MB", MAX_IMAGE_BYTES === 5 * 1024 * 1024);
}

_resetActorRefDeps();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
