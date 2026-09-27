CREATE TABLE "production_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"project_id" integer,
	"episode_id" integer,
	"shot_id" integer,
	"provider" text NOT NULL,
	"provider_job_id" text,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "continuity_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"shot_id" integer,
	"character_match" boolean DEFAULT true,
	"clothing_match" boolean DEFAULT true,
	"location_match" boolean DEFAULT true,
	"lighting_match" boolean DEFAULT true,
	"dialogue_match" boolean DEFAULT true,
	"timeline_logic" boolean DEFAULT true,
	"scene_transition_valid" boolean DEFAULT true,
	"decision" text DEFAULT 'PASS' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"backup_type" text NOT NULL,
	"storage_target" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"file_size_key" text,
	"destination_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"episode_id" integer,
	"shot_id" integer,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text NOT NULL,
	"url_path" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"character_id" integer,
	"world_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"project_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"world_id" text NOT NULL,
	"synopsis" text,
	"style" text DEFAULT 'drama' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "world_profiles" ALTER COLUMN "visual_style" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "face_description" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "eyes" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "hair" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "hairstyle" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "skin_description" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "body_description" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "distinctive_features" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "default_wardrobe" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "wardrobe_colors" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "accessories" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "personality" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "background" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "behavior" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "speaking_style" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "character_prompt" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "negative_prompt" text;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "voice_settings" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "season_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "episode_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "season_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "episode_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "source_asset_id" integer;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "start_time" text DEFAULT '00:00.00';--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "end_time" text;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "timeline_position" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "track" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "audio_settings" text;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "transition" text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "subtitles" text;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "effects" text;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "season_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD COLUMN "episode_number" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "description" text NOT NULL;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "geography" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "architecture" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "technology_level" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "clothing_style" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "weather" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "lighting" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "color_palette" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "master_prompt" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "negative_prompt" text;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_checks" ADD CONSTRAINT "continuity_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_checks" ADD CONSTRAINT "continuity_checks_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_backups" ADD CONSTRAINT "storage_backups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_actor_unique_idx" ON "project_actors" USING btree ("project_id","actor_id");--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "clothing_prompt";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "physical_description";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "personality_traits";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "backstory";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "face_reference_url";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "visual_reference_url";--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "voice_provider";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "shot_id";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "video_url";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "audio_url";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "subtitle_text";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "timeline_start";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "timeline_end";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "track_layer";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "transition_type";--> statement-breakpoint
ALTER TABLE "edit_clips" DROP COLUMN "transition_duration";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "era";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "lighting_type";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "color_grading";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "architecture_style";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "master_style_prompt";--> statement-breakpoint
ALTER TABLE "world_profiles" DROP COLUMN "negative_style_prompt";