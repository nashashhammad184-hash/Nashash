// Load Kayan .env explicitly before any other module reads process.env.
// This makes pm2's cached/stale env irrelevant (74183).
import dotenv from 'dotenv';
const p = process.env.KAYAN_ENV_FILE || '/home/ubuntu/Nashash/.env';
const r = dotenv.config({ path: p, override: true });
console.log(`[loadEnv] loaded ${p} err=${r.error ? r.error.message : 'none'} GPU_SSH_TARGET=${process.env.GPU_SSH_TARGET}`);
