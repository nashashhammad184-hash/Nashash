import { db, workerHeartbeatsTable } from "@workspace/db";
import { desc, like } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { validateEnv } from "../lib/validateEnv";

const router: IRouter = Router();

// KAYAN-7: /healthz shows READINESS, not just liveness.
// status stays "ok" for backward compatibility (Render healthcheck).
// ready=false means a required provider is misconfigured.
// NEVER exposes env VALUES — only provider names + warning codes.
router.get("/healthz", async (_req, res) => {
  const role = ((process.env.SERVICE_ROLE || "").toLowerCase() || "api") as any;
  const safeRole = ["api","queue-worker","production-worker"].includes(role) ? role : "api";
  const r = validateEnv(safeRole);

  
  let phoneOnline = false;
  let phoneLastHeartbeat = null;
  let phoneName = null;
  
  try {
    const [hb] = await db.select()
      .from(workerHeartbeatsTable)
      .where(like(workerHeartbeatsTable.name, "phone%"))
      .orderBy(desc(workerHeartbeatsTable.lastSeenAt))
      .limit(1);
    
    if (hb) {
      phoneLastHeartbeat = hb.lastSeenAt.toISOString();
      phoneName = hb.name;
      const ageMs = Date.now() - hb.lastSeenAt.getTime();
      phoneOnline = ageMs < 90000;
    }
  } catch (e) {
    // silent
  }

  const audioStatus = {
    phoneOnline,
    phoneLastHeartbeat,
    phoneName,
    phoneWorkerConfigured: true,
    deepgramFallbackAvailable: true,
    deepgramSupportsArabic: false
  };

  res.json({
    status: "ok",
    ready: r.ok,
    role: safeRole,
    timestamp: new Date().toISOString(),
    providers: r.providers,
    warnings: r.warnings,
    errors: r.errors,
    audio: audioStatus,
  });
});

export default router;
