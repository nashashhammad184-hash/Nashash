/**
 * KAYAN-7: unit tests for isRealAIProvider — the source of truth that
 * prevents mock videos from being presented as AI output.
 */
import { isRealAIProvider } from "../src/lib/providers/video/realAI";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean) => {
  console.log((ok ? "PASS " : "FAIL ") + n);
  ok ? passed++ : failed++;
};

report("R1 wavespeed → true", isRealAIProvider("wavespeed") === true);
report("R2 mock → false", isRealAIProvider("mock") === false);
report("R3 kayan-gpu-worker → true", isRealAIProvider("kayan-gpu-worker") === true);
report("R4 external-mock → false (mock label from activeProvider)", isRealAIProvider("external-mock") === false);
report("R5 null → false", isRealAIProvider(null) === false);
report("R6 undefined → false", isRealAIProvider(undefined) === false);
report("R7 empty string → false", isRealAIProvider("") === false);
report("R8 MOCK (uppercase) → true (case-sensitive, only exact \"mock\" and *-mock are false)", isRealAIProvider("MOCK") === true);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
