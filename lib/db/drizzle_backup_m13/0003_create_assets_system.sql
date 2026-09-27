CREATE TABLE IF NOT EXISTS "assets" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "target_id" text NOT NULL,
  "asset_type" text NOT NULL,
  "asset_url" text NOT NULL,
  "meta_data" text
);
