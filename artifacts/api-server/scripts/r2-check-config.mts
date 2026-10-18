/**
 * KAYAN-TASK-70: R2 configuration checker.
 *
 * Read-only diagnostic. Prints SET / NOT_SET for each required env var
 * WITHOUT printing any value. Never makes a network call.
 *
 * Usage:
 *   pnpm exec tsx scripts/r2-check-config.mts
 */
const required = [
  "STORAGE_PROVIDER",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;
const optional = ["R2_ENDPOINT", "R2_PUBLIC_BASE_URL"] as const;

function status(k: string): "SET" | "NOT_SET" {
  const v = process.env[k];
  return v && v.trim().length > 0 ? "SET" : "NOT_SET";
}

console.log("=== R2 CONFIG CHECK (no values shown) ===\n");

const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
console.log(`STORAGE_PROVIDER current: ${provider}`);
if (provider === "local") {
  console.log("  → Local mode active. R2 variables are NOT required.\n");
} else if (provider === "r2") {
  console.log("  → R2 mode active. All required vars must be SET.\n");
}

console.log("Required:");
for (const k of required) {
  const s = status(k);
  const marker = s === "SET" ? "✓" : "✗";
  console.log(`  ${marker} ${k} = ${s}`);
}

console.log("\nOptional:");
for (const k of optional) {
  const s = status(k);
  console.log(`  · ${k} = ${s}`);
}

let ok = true;
if (provider === "r2") {
  for (const k of required) {
    if (k === "STORAGE_PROVIDER") continue;
    if (status(k) === "NOT_SET") ok = false;
  }
}
console.log(`\nRESULT = ${ok ? "READY_FOR_R2_INIT" : "MISSING_CONFIG_FOR_R2"}`);
process.exit(ok ? 0 : 1);
