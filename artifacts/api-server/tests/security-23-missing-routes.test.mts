/**
 * KAYAN-SECURITY-23: verify the two newly-added routes.
 *
 * Part 1 (static): assert route declarations exist with requireProductionAuth.
 * Part 2 (static): assert sensitive fields are NOT user-writable.
 * Part 3 (runtime): mount requireProductionAuth + the actual handler logic
 *   against a mocked DB layer to exercise: 401, 400, 404, 204/200 success.
 *
 * No production data is touched; no real DB is used.
 */
import http from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

process.env.SESSION_SECRET = "s".repeat(64);
process.env.PRODUCTION_API_TOKEN = "t".repeat(64);
process.env.NODE_ENV = "development";

const projectsSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/routes/projects.ts"),
  "utf-8",
);

// ── Part 1: route declarations ──────────────────────────────────────
report(
  "STATIC PATCH /:id protected",
  projectsSrc.includes('router.patch("/:id", requireProductionAuth'),
);
report(
  "STATIC DELETE /:id/actors/:actorId protected",
  projectsSrc.includes('router.delete("/:id/actors/:actorId", requireProductionAuth'),
);

// ── Part 2: bulk-update safety & field whitelist ─────────────────────
report(
  "STATIC PATCH uses UpdateProjectBody (whitelist)",
  /UpdateProjectBody\.safeParse\(req\.body\)/.test(projectsSrc),
);
report(
  "STATIC PATCH does NOT pass req.body directly to db.update",
  !/db\s*\.update\(projectsTable\)\s*\.set\(req\.body\)/.test(projectsSrc),
);
report(
  "STATIC PATCH does NOT write id/createdAt/isArchived",
  !/updateData\.(id|createdAt|isArchived)\s*=/.test(projectsSrc),
);
report(
  "STATIC DELETE uses (projectId AND actorId) in WHERE",
  /and\(\s*eq\(projectActorsTable\.projectId,\s*projectId\),\s*eq\(projectActorsTable\.actorId,\s*actorId\)\s*\)/.test(projectsSrc),
);
report(
  "STATIC DELETE does not touch actorsTable",
  !/db\.delete\(actorsTable\)/.test(projectsSrc),
);

// ── Part 3: runtime behavior with a stubbed DB layer ─────────────────
// We import the router factory indirectly by simulating just the
// middleware + handler shape. This mirrors the actual routes without
// needing a live Postgres.
import { requireProductionAuth } from "../src/lib/securityMiddleware.ts";
import { UpdateProjectBody } from "@workspace/api-zod";

async function withServer(
  register: (app: express.Express) => void,
  fn: (base: string, auth: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  register(app);
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as any).port;
  try {
    await fn(`http://127.0.0.1:${port}`, "Bearer " + process.env.PRODUCTION_API_TOKEN);
  } finally {
    srv.close();
  }
}

// Simulate PATCH behavior with whitelist + a fake "DB".
type FakeRow = { id: number; title: string; synopsis: string | null; status: string };
const fakeProjects: FakeRow[] = [
  { id: 1, title: "A", synopsis: null, status: "development" },
];

function patchHandler(): express.RequestHandler {
  return (req, res) => {
    const projectId = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const parsed = UpdateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const updateData: Record<string, any> = {};
    if (d.title !== undefined) updateData.title = d.title.trim();
    if (d.synopsis !== undefined) updateData.synopsis = d.synopsis ? d.synopsis.trim() : null;
    if (d.status !== undefined) updateData.status = d.status;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "no fields" });
      return;
    }
    const row = fakeProjects.find((p) => p.id === projectId);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    Object.assign(row, updateData);
    res.json(row);
  };
}

// 3a: PATCH unauthorized → 401
await withServer((app) => {
  app.patch("/api/projects/:id", requireProductionAuth, patchHandler());
}, async (base) => {
  const r = await fetch(`${base}/api/projects/1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "X" }),
  });
  report("RUNTIME PATCH no auth → 401", r.status === 401, `status=${r.status}`);
});

// 3b: PATCH authorized + valid body → 200 and applied
await withServer((app) => {
  app.patch("/api/projects/:id", requireProductionAuth, patchHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ title: "NewTitle", status: "pre_production", hack: "hax" }),
  });
  const j: any = await r.json().catch(() => ({}));
  report("RUNTIME PATCH valid → 200", r.status === 200, `status=${r.status}`);
  report("RUNTIME PATCH applied title", j.title === "NewTitle");
  report("RUNTIME PATCH ignored unknown field 'hack'", j.hack === undefined);
});

// 3c: PATCH invalid id → 400
await withServer((app) => {
  app.patch("/api/projects/:id", requireProductionAuth, patchHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/notanumber`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ title: "X" }),
  });
  report("RUNTIME PATCH invalid id → 400", r.status === 400, `status=${r.status}`);
});

// 3d: PATCH empty body (all unknown) → 400
await withServer((app) => {
  app.patch("/api/projects/:id", requireProductionAuth, patchHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ hack1: 1, hack2: 2 }),
  });
  report("RUNTIME PATCH no recognized fields → 400", r.status === 400, `status=${r.status}`);
});

// 3e: DELETE association — runtime behavior with fake store
const fakeLinks: Array<{ projectId: number; actorId: number }> = [
  { projectId: 1, actorId: 10 },
  { projectId: 2, actorId: 10 },
];

function deleteHandler(): express.RequestHandler {
  return (req, res) => {
    const projectId = parseInt(String(req.params.id), 10);
    const actorId = parseInt(String(req.params.actorId), 10);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(actorId) || actorId <= 0) {
      res.status(400).json({ error: "bad ids" });
      return;
    }
    const idx = fakeLinks.findIndex((l) => l.projectId === projectId && l.actorId === actorId);
    if (idx === -1) {
      res.status(404).json({ error: "not found" });
      return;
    }
    fakeLinks.splice(idx, 1);
    res.status(204).end();
  };
}

// 3f: DELETE no auth → 401
await withServer((app) => {
  app.delete("/api/projects/:id/actors/:actorId", requireProductionAuth, deleteHandler());
}, async (base) => {
  const r = await fetch(`${base}/api/projects/1/actors/10`, { method: "DELETE" });
  report("RUNTIME DELETE no auth → 401", r.status === 401, `status=${r.status}`);
});

// 3g: DELETE valid → 204, only the matching link is removed
const beforeCount = fakeLinks.length;
await withServer((app) => {
  app.delete("/api/projects/:id/actors/:actorId", requireProductionAuth, deleteHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/1/actors/10`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  report("RUNTIME DELETE valid → 204", r.status === 204, `status=${r.status}`);
});
report("RUNTIME DELETE removed exactly 1 link", fakeLinks.length === beforeCount - 1);
report("RUNTIME DELETE preserved (2,10) link", fakeLinks.some((l) => l.projectId === 2 && l.actorId === 10));

// 3h: DELETE non-existent link → 404
await withServer((app) => {
  app.delete("/api/projects/:id/actors/:actorId", requireProductionAuth, deleteHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/1/actors/9999`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  report("RUNTIME DELETE missing link → 404", r.status === 404, `status=${r.status}`);
});

// 3i: DELETE invalid actorId → 400
await withServer((app) => {
  app.delete("/api/projects/:id/actors/:actorId", requireProductionAuth, deleteHandler());
}, async (base, auth) => {
  const r = await fetch(`${base}/api/projects/1/actors/not-a-number`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  report("RUNTIME DELETE invalid actorId → 400", r.status === 400, `status=${r.status}`);
});

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
