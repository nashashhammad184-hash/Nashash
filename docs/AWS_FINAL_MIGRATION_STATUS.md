# AWS FINAL MIGRATION STATUS

Date: 2026-10-04

## TRANSFERRED (to GitHub/Northflank/Aiven)
- Nashash source code         -> GitHub (public repo)
- Migration archive           -> GitHub Nashash-Migration-Backup (private)
- test_char_face.jpg          -> GitHub Nashash-Migration-Backup
- DB dump (nashash_database)  -> Aiven PostgreSQL
- DB dump (kayan_queue)       -> Aiven PostgreSQL
- Dockerfile + .dockerignore  -> GitHub
- externalVideoProvider.ts    -> GitHub
- waveSpeedProvider.ts        -> GitHub
- mockProvider.ts             -> GitHub
- docs/*                      -> GitHub

## BACKED_UP (in NASHASH-MIGRATION-SAFE.tar.gz on GitHub)
- 94 files including manifests, restore scripts, GPU env snapshot,
  I2V baseline, model manifest, checkpoint restore plan

## LOST (unrecoverable)
- HunyuanVideo 1.5 I2V Step-Distilled checkpoint (33.3 GB)
  Was on Instance Store, wiped on GPU instance Stop.
  Recovery: re-download from HuggingFace tencent/HunyuanVideo-1.5

## NOT_NEEDED (safe to delete when AWS is terminated)
- .env (contains old secrets, most rotated)
- pm2_dump.pm2 (old env cache)
- kayan-gpu-discovery.log
- node_modules (~500MB, reinstallable)
- dist/ (rebuildable)

## STILL_ON_AWS (decide before termination)
- ~/Nashash/uploads/videos/          (64 MB)
- ~/Nashash/uploads/renders/         (8.7 MB)
- ~/.ssh/kayan_gpu                   (SSH key)
- ~/NASHASH-MIGRATION-PRIVATE/       (25 KB, contains old env backups)

## CHECKPOINT_STATUS
CHECKPOINT_STATUS=LOST
CHECKPOINT_RESTORE_REQUIRED=YES
