/**
 * KAYAN-GUARD-30: resolveActorReference must fall back to character_references
 * when the actor row has no image columns. No real DB.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveActorReference,
  _setActorRefDeps,
  _resetActorRefDeps,
} from "../src/lib/actorReference";
import { getTableName } from "drizzle-orm";
import { characterReferencesTable } from "@workspace/db";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Temp image
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ga30-"));
const img = path.join(tmp, "ref.png");
const buf = Buffer.alloc(50 * 1024, 0);
buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
fs.writeFileSync(img, buf);

let actorRow: any = { id: 7, name: "Tester" };
let refRows: any[] = [];
let usedUrl = "";

function makeHybrid(result: any): any {
  // Awaitable + has .limit() and .orderBy() that also return the same
  const p: any = Promise.resolve(result);
  p.limit = async () => result;
  p.orderBy = async () => result;
  return p;
}

function makeFakeDb() {
  return {
    select: (_cols?: any) => ({
      from: (table: any) => {
        const tn = getTableName(table);
        const isRefs = tn === getTableName(characterReferencesTable);
        const isActors = tn === "actors" || tn.endsWith("actors") && !tn.includes("project") && !tn.includes("character");
        const isProjectActors = tn.includes("project_actors") || tn.includes("projectActors");
        return {
          where: (_cond: any) => {
            if (isRefs) {
              // _pickReferenceFromTable awaits directly (no .limit())
              return makeHybrid(refRows);
            }
            if (isActors) return makeHybrid([actorRow]);
            if (isProjectActors) return makeHybrid([{ actorId: 7 }]);
            return makeHybrid([]);
          },
        };
      },
    }),
  } as any;
}

_setActorRefDeps({
  getDb: () => makeFakeDb(),
  resolveLocal: async (u: string) => { usedUrl = u; return { path: img, cleanup: async () => {} }; },
  readFile: (q: string) => fs.readFileSync(q),
  statFile: (q: string) => ({ size: fs.statSync(q).size }),
});

// ─── G30-01: nothing anywhere → 400
refRows = []; actorRow = { id: 7, name: "Tester" }; usedUrl = "";
{
  const r = await resolveActorReference({ actorId: 7, projectId: 1 });
  report("G30-01 no image anywhere → 400", r.ok === false && r.status === 400 && /no reference image/.test(r.error), r.ok ? "ok" : String(r.error));
}

// ─── G30-02: refs has one image → ok
refRows = [{ id: 1, actorId: 7, assetUrl: "uploads/canonical_faces/x.png", referenceType: "image", isPrimary: false }];
actorRow = { id: 7, name: "Tester" }; usedUrl = "";
{
  const r = await resolveActorReference({ actorId: 7, projectId: 1 });
  report("G30-02 fallback ref image → ok", r.ok === true && r.source === "actor", r.ok ? "ok" : String(r.error));
  report("G30-03 base64 present", r.ok === true && typeof r.referenceImageBase64 === "string" && r.referenceImageBase64.length > 100);
}

// ─── G30-04: primary wins
refRows = [
  { id: 1, actorId: 7, assetUrl: "uploads/canonical_faces/nonprimary.png", referenceType: "image", isPrimary: false },
  { id: 2, actorId: 7, assetUrl: "uploads/canonical_faces/primary.png", referenceType: "image", isPrimary: true },
];
actorRow = { id: 7, name: "Tester" }; usedUrl = "";
{
  const r = await resolveActorReference({ actorId: 7, projectId: 1 });
  report("G30-04 primary preferred", r.ok === true && usedUrl.includes("primary.png"), "used=" + usedUrl);
}

// ─── G30-05: actor column wins
actorRow = { id: 7, name: "Tester", imageUrl: "uploads/direct/from-actor.png" };
usedUrl = "";
{
  const r = await resolveActorReference({ actorId: 7, projectId: 1 });
  report("G30-05 actor column wins", r.ok === true && usedUrl.includes("from-actor"), "used=" + usedUrl);
}

// ─── G30-06: non-image only → impl still falls back to rows[0]
actorRow = { id: 7, name: "Tester" };
refRows = [{ id: 3, actorId: 7, assetUrl: "uploads/canonical_faces/notimage.txt", referenceType: "video", isPrimary: true }];
usedUrl = "";
{
  const r = await resolveActorReference({ actorId: 7, projectId: 1 });
  report("G30-06 non-image only → impl fallback", r.ok === true, r.ok ? "ok" : String(r.error));
}

_resetActorRefDeps();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log("SUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
