/**
 * KI-004 — GET /projects/:id/actors. DI + fakeDb. NO real DB. NO paid calls.
 */
import { listProjectActorsHandler, _setProjectsDeps, _resetProjectsDeps } from "../src/routes/projects.ts";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, ev = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${ev ? " :: " + ev : ""}`); ok ? pass++ : fail++; };

let projRows: any[] = [];
let linkRows: any[] = [];

function makeRes() { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }
function makeReq(id: any) { return { params: { id } } as any; }

function makeFakeDb() {
  return {
    select: (_cols?: any) => ({
      from: (t: any) => ({
        where: (_c: any) => ({ limit: async (_n: number) => projRows }),
        innerJoin: (_t2: any, _on: any) => ({ where: async (_c: any) => linkRows }),
      }),
    }),
  };
}

async function reset() { projRows = []; linkRows = []; _setProjectsDeps({ db: makeFakeDb() }); }

// A. project exists + has actors → 200 with merged actor
await reset();
projRows = [{ id: 650 }];
linkRows = [{ id: 6, projectId: 650, actorId: 38, roleName: "صفية", roleType: "lead", createdAt: "t", actor: { id: 38, name: "صفية", type: "عربي", category: "global", age: 30, style: "x", imageUrl: "/uploads/actor-refs/a.png" } }];
{ const res = makeRes(); await listProjectActorsHandler(makeReq("650"), res);
  check("A1 200", res.statusCode === 200, "got " + res.statusCode);
  check("A2 array len 1", Array.isArray(res.body) && res.body.length === 1);
  check("A3 actorId=38", res.body?.[0]?.actorId === 38);
  check("A4 roleName صفية", res.body?.[0]?.roleName === "صفية");
  check("A5 merged actor.name", res.body?.[0]?.actor?.name === "صفية"); }

// B. project exists + empty staff → 200 []
await reset(); projRows = [{ id: 650 }];
{ const res = makeRes(); await listProjectActorsHandler(makeReq("650"), res);
  check("B1 200", res.statusCode === 200);
  check("B2 empty array", Array.isArray(res.body) && res.body.length === 0); }

// C. project missing → 404
await reset(); projRows = [];
{ const res = makeRes(); await listProjectActorsHandler(makeReq("999999"), res);
  check("C1 404", res.statusCode === 404, "got " + res.statusCode);
  check("C2 error PROJECT_NOT_FOUND", res.body?.error === "PROJECT_NOT_FOUND"); }

// D. non-numeric id → 400
await reset();
{ const res = makeRes(); await listProjectActorsHandler(makeReq("abc"), res);
  check("D1 400 non-numeric", res.statusCode === 400, "got " + res.statusCode);
  check("D2 INVALID_PROJECT_ID", res.body?.error === "INVALID_PROJECT_ID"); }

// E. id=0 and id=-5 → 400
await reset();
{ const res = makeRes(); await listProjectActorsHandler(makeReq("0"), res);
  check("E1 id=0 → 400", res.statusCode === 400); }
{ const res = makeRes(); await listProjectActorsHandler(makeReq("-5"), res);
  check("E2 id=-5 → 400", res.statusCode === 400); }

_resetProjectsDeps();
console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
