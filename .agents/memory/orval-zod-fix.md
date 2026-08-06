---
name: Orval Zod v3 codegen fix
description: After every codegen run, the generated Zod schema file must be patched for Zod v3 compatibility.
---

**Rule:** After running `pnpm run codegen` (or any Orval codegen step), immediately run:
```bash
sed -i 's/zod\.int()/zod.number()/g' lib/api-zod/src/generated/api.ts
```

**Why:** Orval generates `zod.int()` for OpenAPI `type: integer` fields, but Zod v3 does not have a `.int()` method — it was added in Zod v4. The project uses Zod v3. Skipping this patch causes a runtime crash on any route that validates integer fields.

**How to apply:** Run the sed command immediately after every codegen invocation, before any build or typecheck step. Also change all `type: integer` fields to `type: number` in `lib/api-spec/openapi.yaml` as a first-line defense; the sed is a second safety net.
