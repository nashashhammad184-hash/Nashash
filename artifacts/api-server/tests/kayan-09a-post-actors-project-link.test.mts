/**
 * KAYAN-9a — POST /actors accepts optional projectId (auto-link to project_actors).
 * DI + fakeDb. NO real DB. NO paid calls.
 */
import { handleCreateActor, _setActorsCreateDeps, _resetActorsCreateDeps } from "../src/routes/actors.ts";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, ev = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${ev ? " :: " + ev : ""}`); ok ? pass++ : fail++; };

type Row = Record<string, any>;
let projRows: Row[] = [];
let linkInserted: Row[] = [];
let actorSeq = 1000;

function makeRes() { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }
function makeReq(body: any) { return { body } as any; }

function makeFakeDb() {
  const tx: any = {
    select: () => ({ from: (_t: any) => ({ where: (_c: any) => ({ limit: async (_n: number) => projRows }) }) }),
    insert: (_t: any) => ({ values: (v: any) => {
      if ("actorId" in v && "projectId" in v) { linkInserted.push(v); return { returning: async () => [{ id: 1, ...v }] }; }
      const row = { id: actorSeq++, ...v };
      return { returning: async () => [row] };
    } }),
  };
  return { transaction: async (fn: any) => { return await fn(tx); } };
}

async function reset() { projRows = []; linkInserted = []; actorSeq = 1000; _setActorsCreateDeps({ db: makeFakeDb() }); }

const base = { name: "K9a", type: "عربي", age: 30, style: "test" };

// A. no projectId → 201, no link
await reset();
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, name: "K9a-noProj" }), res);
  check("A1 no projectId → 201", res.statusCode === 201, "got " + res.statusCode);
  check("A2 no link inserted", linkInserted.length === 0, "links=" + linkInserted.length); }

// B. projectId=650 (exists) → 201, link inserted
await reset(); projRows = [{ id: 650 }];
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, name: "K9a-ok", projectId: 650 }), res);
  check("B1 with projectId=650 → 201", res.statusCode === 201, "got " + res.statusCode);
  check("B2 exactly 1 link", linkInserted.length === 1, "links=" + linkInserted.length);
  check("B3 link fields", linkInserted[0]?.projectId === 650 && linkInserted[0]?.actorId === 1000 && linkInserted[0]?.roleName === "K9a-ok" && linkInserted[0]?.roleType === "supporting", JSON.stringify(linkInserted[0])); }

// C. projectId=999999 (missing) → 404, no actor, rollback proof
await reset(); projRows = [];
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, name: "K9a-bad", projectId: 999999 }), res);
  check("C1 missing project → 404", res.statusCode === 404, "got " + res.statusCode);
  check("C2 error PROJECT_NOT_FOUND", res.body?.error === "PROJECT_NOT_FOUND", JSON.stringify(res.body));
  check("C3 NO actor inserted (rollback)", actorSeq === 1000, "actorSeq=" + actorSeq);
  check("C4 NO link inserted", linkInserted.length === 0, "links=" + linkInserted.length); }

// D. projectId="abc" → 400
await reset();
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, projectId: "abc" }), res);
  check("D1 projectId=abc → 400", res.statusCode === 400, "got " + res.statusCode);
  check("D2 error INVALID_PROJECT_ID", res.body?.error === "INVALID_PROJECT_ID", JSON.stringify(res.body)); }

// E. projectId=-5 → 400
await reset();
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, projectId: -5 }), res);
  check("E1 projectId=-5 → 400", res.statusCode === 400, "got " + res.statusCode); }

// F. projectId=null → 201, no link (backward compat)
await reset();
{ const res = makeRes(); await handleCreateActor(makeReq({ ...base, name: "K9a-null", projectId: null }), res);
  check("F1 projectId=null → 201", res.statusCode === 201, "got " + res.statusCode);
  check("F2 no link", linkInserted.length === 0); }

_resetActorsCreateDeps();
console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
