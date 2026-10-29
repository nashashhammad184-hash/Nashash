import { Router, type IRouter } from "express";
import { validateEnv } from "../lib/validateEnv";

const router: IRouter = Router();

// KAYAN-7: /healthz shows READINESS, not just liveness.
// status stays "ok" for backward compatibility (Render healthcheck).
// ready=false means a required provider is misconfigured.
// NEVER exposes env VALUES — only provider names + warning codes.
router.get("/healthz", (_req, res) => {
  const role = ((process.env.SERVICE_ROLE || "").toLowerCase() || "api") as any;
  const safeRole = ["api","queue-worker","production-worker"].includes(role) ? role : "api";
  const r = validateEnv(safeRole);

  res.json({
    status: "ok",
    ready: r.ok,
    role: safeRole,
    timestamp: new Date().toISOString(),
    providers: r.providers,
    warnings: r.warnings,
    errors: r.errors,
  });
});

export default router;
