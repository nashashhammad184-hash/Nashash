/**
 * KAYAN-SECURITY-21: verify all state-changing routes are protected.
 *
 * Part 1 (static): scan source and confirm `requireProductionAuth` appears
 * in every mutation route declaration across shots/projects/clips/tasks/
 * bible/actors.
 *
 * Part 2 (static): verify bulk-update enforces projectId scope at the DB
 * WHERE level (not just request body check).
 *
 * Part 3 (runtime): mount requireProductionAuth in a minimal express app
 * and verify the four canonical behaviors:
 *   - no auth, token configured    → 401
 *   - wrong bearer, token configured → 401
 *   - correct bearer               → 200 (middleware calls next)
 *   - no token configured (dev, no bypass) → 503
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
delete process.env.ALLOW_DEV_PRODUCTION_BYPASS;

// ── Part 1: static route protection ─────────────────────────────────
const ROUTES_DIR = path.resolve(process.cwd(), "src/routes");

const expectedProtected: Array<[string, string, string]> = [
  ["shots.ts", "post", "/shots"],
  ["shots.ts", "post", "/shots/bulk-update"],
  ["shots.ts", "patch", "/shots/:id"],
  ["shots.ts", "delete", "/shots/:id"],
  ["projects.ts", "post", "/"],
  ["projects.ts", "post", "/:id/actors"],
  ["clips.ts", "post", "/clips"],
  ["clips.ts", "patch", "/clips/:id"],
  ["clips.ts", "delete", "/clips/:id"],
  ["tasks.ts", "post", "/tasks"],
  ["tasks.ts", "patch", "/tasks/:id"],
  ["tasks.ts", "delete", "/tasks/:id"],
  ["bible.ts", "post", "/projects/:id/world-bible"],
  ["bible.ts", "patch", "/actors/:id/bible"],
  ["actors.ts", "post", "/actors"],
  ["actors.ts", "patch", "/actors/:id"],
  ["actors.ts", "delete", "/actors/:id"],
  ["actors.ts", "post", "/actors/:actorId/references"],
  ["actors.ts", "delete", "/references/:id"],
  ["actors.ts", "patch", "/references/:id/primary"],
];

for (const [file, method, routePath] of expectedProtected) {
  const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf-8");
  const needle = `router.${method}("${routePath}", requireProductionAuth`;
  report(`STATIC ${file}::${method.toUpperCase()} ${routePath}`, src.includes(needle));
}

// ── Part 2: bulk-update scoping ─────────────────────────────────────
const shotsSrc = fs.readFileSync(path.join(ROUTES_DIR, "shots.ts"), "utf-8");
report("STATIC bulk-update requires integer projectId",
  /Number\.isInteger\(projectIdNum\)/.test(shotsSrc));
report("STATIC bulk-update scoped WHERE (id AND projectId)",
  /and\(eq\(shotsTable\.id, s\.id\), eq\(shotsTable\.projectId, projectIdNum\)\)/.test(shotsSrc));

// ── Part 3: runtime middleware behavior ────────────────────────────
import { requireProductionAuth } from "../src/lib/securityMiddleware.ts";

async function withServer(handler: express.RequestHandler, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.post("/api/p", handler, (_req, res) => { res.json({ ok: true }); });
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as any).port;
  try { await fn(`http://127.0.0.1:${port}`); } finally { srv.close(); }
}

// 3a: no auth → 401 (token configured)
await withServer(requireProductionAuth, async (base) => {
  const r = await fetch(`${base}/api/p`, { method: "POST" });
  report("RUNTIME no auth → 401", r.status === 401, `status=${r.status}`);
});

// 3b: wrong bearer → 401
await withServer(requireProductionAuth, async (base) => {
  const r = await fetch(`${base}/api/p`, {
    method: "POST",
    headers: { Authorization: "Bearer wrong" },
  });
  report("RUNTIME wrong bearer → 401", r.status === 401, `status=${r.status}`);
});

// 3c: correct bearer → 200
await withServer(requireProductionAuth, async (base) => {
  const r = await fetch(`${base}/api/p`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.PRODUCTION_API_TOKEN },
  });
  report("RUNTIME correct bearer → 200", r.status === 200, `status=${r.status}`);
});

// 3d: no token configured (dev, no bypass) → 503
{
  const old = process.env.PRODUCTION_API_TOKEN;
  delete process.env.PRODUCTION_API_TOKEN;
  try {
    await withServer(requireProductionAuth, async (base) => {
      const r = await fetch(`${base}/api/p`, { method: "POST" });
      report("RUNTIME no token configured → 503", r.status === 503, `status=${r.status}`);
    });
  } finally {
    process.env.PRODUCTION_API_TOKEN = old;
  }
}

console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
