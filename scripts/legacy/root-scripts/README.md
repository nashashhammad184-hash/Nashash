# Legacy Root Scripts — UNTRUSTED

These files were moved here by KAYAN-FIX-07 (2026-09-27) because they sat in the
project root as leftovers from earlier experimental phases and are **not imported
from any production path** (`artifacts/api-server/src` or `artifacts/studio/src`).

Status: legacy, unverified, potentially referencing removed providers
(e.g. Replicate). Do NOT treat any of them as a source of truth for current
behavior. Do NOT import them from production code.

The production pipeline lives in:
- artifacts/api-server/src/routes/pipeline.ts
- artifacts/api-server/src/lib/productionEngine.ts
- artifacts/api-server/src/routes/voice.ts (Deepgram)
- artifacts/api-server/src/lib/kayanGpuProvider.ts

No files were deleted — only relocated.
