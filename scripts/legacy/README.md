# ⚠️  scripts/legacy — UNTRUSTED

Files here are preserved for reference ONLY. They are NOT imported by any
production path under `artifacts/**`. They may reference removed providers
(e.g. Replicate), demo assets, or local-only state. Do NOT treat them as a
source of truth for current behavior.

Production entrypoints:
- `artifacts/api-server/src/routes/pipeline.ts`
- `artifacts/api-server/src/lib/productionEngine.ts`
- `artifacts/api-server/src/lib/renderEngine.ts`
- `artifacts/api-server/src/routes/voice.ts`

Any `pnpm run inject:*` script that targets this folder is explicitly marked
`LEGACY-DO-NOT-RUN-IN-PROD`.
