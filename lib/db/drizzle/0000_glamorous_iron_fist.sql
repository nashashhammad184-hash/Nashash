CREATE TABLE "actors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text DEFAULT 'global' NOT NULL,
	"age" integer NOT NULL,
	"style" text NOT NULL,
	"image_url" text,
	"gender" text,
	"clothing_prompt" text,
	"physical_description" text,
	"personality_traits" text,
	"backstory" text,
	"face_reference_url" text,
	"visual_reference_url" text,
	"voice_id" text,
	"voice_provider" text DEFAULT 'elevenlabs'
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"world_id" text NOT NULL,
	"synopsis" text,
	"project_type" text DEFAULT 'film' NOT NULL,
	"style" text DEFAULT 'drama' NOT NULL,
	"status" text DEFAULT 'development' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "project_actors" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"role_name" text NOT NULL,
	"role_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"idea" text NOT NULL,
	"world_id" text NOT NULL,
	"generated_content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"script_id" integer,
	"scene_number" integer NOT NULL,
	"shot_order" integer,
	"description" text NOT NULL,
	"camera_movement" text NOT NULL,
	"duration_seconds" integer DEFAULT 5 NOT NULL,
	"dialogue" text,
	"audio_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"shot_id" integer,
	"task_type" text DEFAULT 'video_generation' NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_name" text,
	"external_job_id" text,
	"result_url" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"assigned_actor_id" integer,
	"due_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_clips" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"shot_id" integer,
	"title" text NOT NULL,
	"video_url" text,
	"audio_url" text,
	"subtitle_text" text,
	"clip_order" integer DEFAULT 0 NOT NULL,
	"timeline_start" real DEFAULT 0 NOT NULL,
	"timeline_end" real DEFAULT 0 NOT NULL,
	"track_layer" integer DEFAULT 1 NOT NULL,
	"transition_type" text DEFAULT 'none',
	"transition_duration" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"era" text,
	"visual_style" text NOT NULL,
	"lighting_type" text,
	"color_grading" text,
	"architecture_style" text,
	"atmosphere" text,
	"master_style_prompt" text,
	"negative_style_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_actors" ADD CONSTRAINT "project_actors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actors" ADD CONSTRAINT "project_actors_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_clips" ADD CONSTRAINT "edit_clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_profiles" ADD CONSTRAINT "world_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_episodes" ADD CONSTRAINT "series_episodes_season_id_series_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."series_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_seasons" ADD CONSTRAINT "series_seasons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;