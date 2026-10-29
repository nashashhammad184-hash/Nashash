# Known Issues

## KI-001 — security-21-writes.test.mts fails on Termux (path resolution)

**Status:** open (scheduled as KAYAN-8.1)
**First observed:** KAYAN-8 (2026-10-29)
**Severity:** low (test-only; production unaffected)

### Symptom
`artifacts/api-server/tests/security-21-writes.test.mts` crashes with:

    Error: ENOENT: no such file or directory, open ".../kayan6-upload/src/routes/shots.ts"

The test uses `path.resolve(process.cwd(), "src/routes")` (line 35),
which assumes CWD is `artifacts/api-server`. On CI this is true. On
Termux the runner stays at repo root, so the path becomes
`<repo>/src/routes/shots.ts` (missing the `artifacts/api-server/`
prefix).

### Impact
- The test does not execute on Termux.
- It still runs on CI where CWD is set correctly.
- No production impact (test-only).

### Fix path (KAYAN-8.1)
Two options:
1. Change the test to derive paths from `import.meta.url` instead of
   `process.cwd()` (portable, preferred).
2. Change the invocation to `cd artifacts/api-server && ...`
   (works but leaves the test fragile).

Option 1 is recommended.

## KI-002 — lib/api-client-react has TS2339 Headers.entries errors

**Status:** open (scheduled as KAYAN-8.1)
**First observed:** KAYAN-8 (2026-10-29) — surfaced when `pnpm codegen`
runs `typecheck:libs` after regenerating.
**Severity:** low (build-time only for the client lib; api-server and
Studio build cleanly).

### Symptom
```
lib/api-client-react/src/generated/api.ts(417,59): error TS2339:
  Property entries does not exist on type Headers.
```
Orval emits `headers.entries()` in the generated fetch wrapper. This
API requires `lib: ["dom", "dom.iterable"]` in the tsconfig, but
`lib/api-client-react/tsconfig.json` is missing `dom.iterable`.

### Impact
- `pnpm run typecheck:libs` fails at repo level.
- `artifacts/api-server` typecheck (tsc -p tsconfig.json --noEmit) is
  clean — it does not pull api-client-react.
- `artifacts/studio` build is clean.
- Runtime unaffected.

### Fix path (KAYAN-8.1)
Add `dom.iterable` to `lib/api-client-react/tsconfig.json` `lib` array.
Then `pnpm run typecheck:libs` becomes green again.

## KI-003 — shots.sceneNumber type drift (DB text vs OpenAPI number)

**Status:** open (documented, not scheduled)
**First observed:** KAYAN-8 (2026-10-29) pre-existing.
**Severity:** low (works today via `String()` coercion in handler).

### Symptom
`lib/db/src/schema/shots.ts:XX` declares `sceneNumber: text("scene_number")`.
OpenAPI declares `sceneNumber: type: number`. Codegen emits
`zod.number()` in the request schema, and `shots.ts` coerces with
`String(...)` before persisting.

### Impact
Works but is fragile: any code path reading `shot.sceneNumber` from DB
gets a string; the API surface advertises a number.

### Fix path (future)
Align the Drizzle column with the DB column type and regenerate.

---

_Last updated: 2026-10-29 (KAYAN-8)_
