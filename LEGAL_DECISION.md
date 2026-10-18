# KAYAN-LEGAL-00 — SYNTHETIC CHARACTER POLICY

Date: 2026-09-26 · Status: ENFORCED

## Policy
All Production characters are fully synthetic. Production must not use real-person
names, images, likeness, celebrity references, or verified-image injection.

## Findings (runtime evidence)
- `actors` rows: 31 — all synthetic fictional Arabic names.
- `image_url` populated: 0
- `face_reference_url / body_reference_url / secondary_reference_url` populated: 0
- `character_references` rows: 0
- `artifacts/api-server/src/inject-verified-images.ts` referenced real-person names
  (ياسمين صبري، هيفاء وهبي، أنجلينا جولي) and injected real-person URLs to `actors.image_url`.
  - Never imported by any src file (grep: empty).
  - Only wired via package.json script `"inject"`.
  - **Action:** moved to `scripts/legacy/inject-verified-images.LEGACY.ts` with LEGACY header.
  - package.json: `inject` removed → `inject:legacy` (points to legacy path).

## Guard
`artifacts/api-server/src/lib/legalGuard.ts`:
- allowed: `data:image/*` · `uploads/*` · `storage_vault/*` · `syntheticAcknowledged===true`
- rejected: any other external URL → HTTP 400 `LEGAL_GUARD_NON_SYNTHETIC`

Applied in `routes/actors.ts`: POST `/actors` and PATCH `/actors/:id` when imageUrl present.

## Untouched
LightX2V · Hunyuan · GPU worker · GPU queue · T2V · I2V · render · voice · UI.

## Evidence
- `grep -rIl inject-verified artifacts/api-server/src` → empty
- `psql "SELECT count(*) FROM actors WHERE image_url IS NOT NULL"` → 0
