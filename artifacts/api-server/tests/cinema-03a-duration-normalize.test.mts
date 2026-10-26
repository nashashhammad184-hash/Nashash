/**
 * KAYAN-CINEMA-03A: verify WaveSpeed Hunyuan 1.5 duration normalization.
 * Pure unit test — no real WaveSpeed API call, no DB, no paid requests.
 */
import { normalizeWaveSpeedDuration } from "../src/lib/providers/video/externalVideoProvider.ts";

let pass = 0, fail = 0;
const check = (name: string, got: number, exp: number) => {
  const ok = got === exp;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} got=${got} exp=${exp}`);
  ok ? pass++ : fail++;
};

// The 6 required cases (input → expected sent duration to WaveSpeed)
check("undefined → 5",   normalizeWaveSpeedDuration(undefined), 5);
check("2 → 5",           normalizeWaveSpeedDuration(2),         5);
check("3 → 5",           normalizeWaveSpeedDuration(3),         5);
check("5 → 5",           normalizeWaveSpeedDuration(5),         5);
check("8 → 8",           normalizeWaveSpeedDuration(8),         8);
check("10 → 5",          normalizeWaveSpeedDuration(10),        5);

// Extra safety cases
check("null → 5",        normalizeWaveSpeedDuration(null),      5);
check("string '8' → 8",  normalizeWaveSpeedDuration("8"),       8);
check("string '5' → 5",  normalizeWaveSpeedDuration("5"),       5);
check("NaN → 5",         normalizeWaveSpeedDuration(NaN),       5);
check("0 → 5",           normalizeWaveSpeedDuration(0),         5);
check("-3 → 5",          normalizeWaveSpeedDuration(-3),        5);
check("4.999 → 5",       normalizeWaveSpeedDuration(4.999),     5);
check("5.1 → 5",         normalizeWaveSpeedDuration(5.1),       5);

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
