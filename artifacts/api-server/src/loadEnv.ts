// Load Kayan .env explicitly before any other module reads process.env.
// This makes pm2's cached/stale env irrelevant (74183).
//
// KAYAN-GUARD-05: never log GPU_SSH_TARGET or any env value to stdout.
// Logs are rotated but visible on disk; the SSH target and other connection
// details must not be part of them. Only a boolean presence flag is safe.
import dotenv from 'dotenv';
const p = process.env.KAYAN_ENV_FILE || '/home/ubuntu/Nashash/.env';
const r = dotenv.config({ path: p, override: true });
const hasSshTarget = !!(process.env.GPU_SSH_TARGET && process.env.GPU_SSH_TARGET.trim().length > 0);
console.log(`[loadEnv] loaded ${p} err=${r.error ? r.error.message : 'none'} gpuSshTarget=${hasSshTarget ? 'configured' : 'missing'}`);
