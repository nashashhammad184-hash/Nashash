import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import fs from "fs";
import path from "path";

const { Pool } = pg;

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL;
  }
  const envPaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    "/home/ubuntu/Nashash/.env"
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      const match = content.match(/DATABASE_URL=["']?([^"'\n\r]+)["']?/);
      if (match && match[1]) {
        process.env.DATABASE_URL = match[1];
        return match[1];
      }
    }
  }
  return process.env.DATABASE_URL || "";
}

const dbUrl = getDatabaseUrl();
const _isRemote = !/localhost|127\.0\.0\.1|::1/.test(dbUrl);
const _sslCaPath = process.env.SSL_CA_PATH || '';
const _sslCa = _sslCaPath && fs.existsSync(_sslCaPath) ? fs.readFileSync(_sslCaPath, 'utf-8') : null;
export const pool = new Pool({
  connectionString: dbUrl,
  ssl: _isRemote
    ? (_sslCa ? { ca: _sslCa, rejectUnauthorized: true } : { rejectUnauthorized: false })
    : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
