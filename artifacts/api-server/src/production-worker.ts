/**
 * KAYAN-TASK-DEPLOY-17: standalone Production Pipeline worker.
 *
 * Runs `startProductionWorker` in a dedicated process. Does NOT start
 * Express, does NOT serve Studio, does NOT bind a port. Suitable for a small
 * VPS or a Render Background Worker when a Queue (Neon) must be drained.
 *
 * Constraints honoured:
 *   - Only processes `production_pipeline` rows. The separate `queue-worker.mjs`
 *     (gpu_jobs) is NOT touched here.
 *   - atomic claim (claimJob) prevents duplicate processing when Render API
 *     also runs an in-process worker on the same DB.
 *   - graceful shutdown on SIGTERM/SIGINT via stopProductionWorker().
 */
import "./loadEnv";
import { assertEnvOrThrow } from './lib/validateEnv';

// KAYAN-7.1: assign role unconditionally — health.ts reads this at request time.
process.env.SERVICE_ROLE = "production-worker";

// KAYAN-7: fail-fast on missing env for production-worker role.
assertEnvOrThrow('production-worker');
import { startProductionWorker, stopProductionWorker } from "./lib/productionEngine";
import { logger } from "./lib/logger";

const POLL_MS = Number(process.env.PRODUCTION_WORKER_POLL_MS || "5000");
const GRACEFUL_SHUTDOWN_MS = Number(process.env.PRODUCTION_WORKER_SHUTDOWN_MS || "10000");

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "production-worker: shutdown requested");
  try {
    stopProductionWorker();
  } catch (e: any) {
    logger.warn({ err: e?.message }, "production-worker: stopProductionWorker failed");
  }
  // Give any in-flight job a short grace period before exiting.
  setTimeout(() => {
    logger.info("production-worker: exiting");
    process.exit(0);
  }, Math.max(1000, Math.min(GRACEFUL_SHUTDOWN_MS, 30000))).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main(): Promise<void> {
  // Refuse to run alongside an in-process worker in the same DB? We can't
  // know that from here. Instead, log a warning if NASHASH_DISABLE_AUTO_WORKER
  // is set to "1": this means the caller intends for THIS process (or another
  // standalone worker) to be the only one. In that case, we explicitly start.
  const disableAuto = process.env.NASHASH_DISABLE_AUTO_WORKER === "1";
  if (!disableAuto) {
    logger.warn(
      "production-worker: NASHASH_DISABLE_AUTO_WORKER is not '1'. If the API also runs an " +
      "in-process worker on the same DB, you will have two workers. The atomic claim prevents " +
      "double processing, but you should still set NASHASH_DISABLE_AUTO_WORKER=1 on the API."
    );
  }

  logger.info({ pollMs: POLL_MS }, "production-worker: starting");
  startProductionWorker(POLL_MS);
  logger.info("production-worker: ready");
}

main().catch((e) => {
  logger.error({ err: e?.message }, "production-worker: fatal");
  process.exit(1);
});
