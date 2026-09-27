ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "video_asset_url" text;
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "start_time" integer DEFAULT 0;
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "end_time" integer DEFAULT 0;
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0;
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "audio_asset_url" text;
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "transition" text DEFAULT 'none';
ALTER TABLE "edit_clips" ADD COLUMN IF NOT EXISTS "subtitle" text;
