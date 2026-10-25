/**
 * KAYAN-CINEMA-17A: behavioral tests for loadActorImageBytes.
 * Mocks DB + storage. NO real DB, NO real storage, NO paid calls.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableName } from "drizzle-orm";
import {
  loadActorImageBytes,
  _setActorRefDeps,
  _resetActorRefDeps,
} from "../src/lib/actorReference.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const tmpDir = "/tmp/cinema-17a-test";
fs.mkdirSync(tmpDir, { recursive: true });

function makePng(size: number): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  return buf;
}
const pngPath = path.join(tmpDir, "ref.png");
fs.writeFileSync(pngPath, makePng(50 * 1024));

type Row = Record<string, any>;
let linkRows: Row[] = [];
let actorRows: Row[] = [];

const fakeDb: any = {
  select: (_cols?: any) => ({
    from: (table: any) => {
      const name = getTableName(table);
      return {
        where: (_cond: any) => ({
          limit: async (_n: number) => {
            if (name === "project_actors") return linkRows;
            if (name === "actors") return actorRows;
            return [];
          },
        }),
      };
    },
  }),
};

function stubDeps(filePath: string | null, cleanupFlag?: { v: boolean }) {
  return {
    getDb: () => fakeDb,
    resolveLocal: async (_url: string) => {
      if (!filePath) throw new Error("simulated resolve failure");
      return {
        path: filePath,
        wasRemote: false,
        cleanup: async () => { if (cleanupFlag) cleanupFlag.v = true; },
      };
    },
    readFile: (p: string) => fs.readFileSync(p),
    statFile: (p: string) => fs.statSync(p),
  };
}

// ─── A. Invalid actorId ─────────────────────────────────────────
{
  _setActorRefDeps(stubDeps(pngPath));
  const r = await loadActorImageBytes(0);
  check("A1 invalid actorId=0 → 400", r.ok === false && r.status === 400);
}
{
  const r = await loadActorImageBytes(-5);
  check("A2 negative actorId → 400", r.ok === false && r.status === 400);
}

// ─── B. Actor not found ────────────────────────────────────────
{
  linkRows = []; actorRows = [];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await loadActorImageBytes(999);
  check("B1 missing actor → 404", r.ok === false && r.status === 404);
}

// ─── C. Actor exists but not linked to any project ────────────
{
  actorRows = [{ id: 42, name: "Orphan", imageUrl: "/uploads/x.png" }];
  linkRows = []; // no links
  _setActorRefDeps(stubDeps(pngPath));
  const r = await loadActorImageBytes(42);
  check("C1 unlinked actor → 404", r.ok === false && r.status === 404);
  check("C2 error mentions link", !r.ok && /link/i.test(r.error));
}

// ─── D. Actor linked but no image URL ─────────────────────────
{
  actorRows = [{ id: 42, name: "NoImg", imageUrl: null, canonicalFaceImagePath: null, faceReferenceUrl: null }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await loadActorImageBytes(42);
  check("D1 no image URL → 404", r.ok === false && r.status === 404);
}

// ─── E. Resolve failure (storage down) ────────────────────────
{
  actorRows = [{ id: 42, name: "Ok", imageUrl: "/uploads/x.png" }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(null));
  const r = await loadActorImageBytes(42);
  check("E1 resolve fail → 404", r.ok === false && r.status === 404);
  check("E2 no path leaked", !r.ok && !/\/tmp|\/uploads\/|\/app\//.test(r.error));
}

// ─── F. Image too small ───────────────────────────────────────
{
  const tinyPath = path.join(tmpDir, "tiny.png");
  fs.writeFileSync(tinyPath, makePng(100));
  actorRows = [{ id: 42, name: "Small", imageUrl: "/uploads/x.png" }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(tinyPath));
  const r = await loadActorImageBytes(42);
  check("F1 too small → 400", r.ok === false && r.status === 400);
}

// ─── G. Not PNG/JPEG ──────────────────────────────────────────
{
  const badPath = path.join(tmpDir, "bad.bin");
  fs.writeFileSync(badPath, Buffer.alloc(50 * 1024, 0x41));
  actorRows = [{ id: 42, name: "Bad", imageUrl: "/uploads/x.bin" }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(badPath));
  const r = await loadActorImageBytes(42);
  check("G1 bad magic → 400", r.ok === false && r.status === 400);
}

// ─── H. Happy path ────────────────────────────────────────────
{
  const cleanupFlag = { v: false };
  actorRows = [{ id: 42, name: "Jana", imageUrl: "/uploads/actors/refs/jana.png" }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(pngPath, cleanupFlag));
  const r = await loadActorImageBytes(42);
  check("H1 happy → ok", r.ok === true);
  check("H2 buffer non-empty", r.ok && r.buffer.length === 50 * 1024);
  check("H3 mime=image/png", r.ok && r.mime === "image/png");
  check("H4 cleanup called", cleanupFlag.v === true);
  check("H5 size matches", r.ok && r.size === 50 * 1024);
}

// ─── I. Prefer canonicalFaceImagePath over imageUrl ───────────
{
  actorRows = [{
    id: 42, name: "Jana",
    canonicalFaceImagePath: "/uploads/canonical.png",
    imageUrl: "/uploads/fallback.png",
    faceReferenceUrl: "/uploads/face.png",
  }];
  linkRows = [{ projectId: 1, actorId: 42 }];
  _setActorRefDeps(stubDeps(pngPath));
  const r = await loadActorImageBytes(42);
  check("I1 happy with canonicalFace", r.ok === true);
}

_resetActorRefDeps();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
