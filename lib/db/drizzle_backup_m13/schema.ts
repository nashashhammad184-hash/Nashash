import { pgTable, foreignKey, serial, integer, text, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const shots = pgTable("shots", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	scriptId: integer("script_id"),
	sceneNumber: integer("scene_number").notNull(),
	shotOrder: integer("shot_order"),
	description: text().notNull(),
	cameraMovement: text("camera_movement").notNull(),
	durationSeconds: integer("duration_seconds").default(5).notNull(),
	dialogue: text(),
	audioNote: text("audio_note"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	seasonNumber: integer("season_number").default(1),
	episodeNumber: integer("episode_number").default(1),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "shots_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.scriptId],
			foreignColumns: [scripts.id],
			name: "shots_script_id_scripts_id_fk"
		}).onDelete("cascade"),
]);

export const projects = pgTable("projects", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	worldId: text("world_id").notNull(),
	synopsis: text(),
	status: text().default('development').notNull(),
	isArchived: boolean("is_archived").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
	projectType: text("project_type").default('film').notNull(),
	style: text().default('drama').notNull(),
});

export const worldProfiles = pgTable("world_profiles", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	visualStyle: text("visual_style"),
	atmosphere: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	location: text(),
	geography: text(),
	architecture: text(),
	clothingStyle: text("clothing_style"),
	lighting: text(),
	colorPalette: text("color_palette"),
	weather: text(),
	masterPrompt: text("master_prompt"),
	negativePrompt: text("negative_prompt"),
	name: text().notNull(),
	description: text().notNull(),
	technologyLevel: text("technology_level"),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "world_profiles_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const productionTasks = pgTable("production_tasks", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	title: text().notNull(),
	status: text().default('pending').notNull(),
	assignedActorId: integer("assigned_actor_id"),
	dueDate: text("due_date"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	shotId: integer("shot_id"),
	taskType: text("task_type").default('video_generation').notNull(),
	providerName: text("provider_name"),
	externalJobId: text("external_job_id"),
	resultUrl: text("result_url"),
	errorMessage: text("error_message"),
	retryCount: integer("retry_count").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "production_tasks_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const scripts = pgTable("scripts", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	idea: text().notNull(),
	worldId: text("world_id").notNull(),
	generatedContent: text("generated_content").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	seasonNumber: integer("season_number").default(1),
	episodeNumber: integer("episode_number").default(1),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "scripts_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const editClips = pgTable("edit_clips", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	title: text().notNull(),
	durationSeconds: integer("duration_seconds"),
	notes: text(),
	clipOrder: integer("clip_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	sourceAssetId: integer("source_asset_id"),
	startTime: text("start_time").default('00:00.00'),
	endTime: text("end_time"),
	timelinePosition: integer("timeline_position").default(0),
	track: integer().default(1),
	audioSettings: text("audio_settings"),
	transition: text().default('none'),
	subtitles: text(),
	effects: text(),
	seasonNumber: integer("season_number").default(1),
	episodeNumber: integer("episode_number").default(1),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "edit_clips_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const projectActors = pgTable("project_actors", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	actorId: integer("actor_id").notNull(),
	roleName: text("role_name").notNull(),
	roleType: text("role_type"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("project_actor_unique_idx").using("btree", table.projectId.asc().nullsLast().op("int4_ops"), table.actorId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_actors_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [actors.id],
			name: "project_actors_actor_id_actors_id_fk"
		}).onDelete("cascade"),
]);

export const actors = pgTable("actors", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	type: text().notNull(),
	age: integer().notNull(),
	style: text().notNull(),
	imageUrl: text("image_url"),
	category: text().default('global').notNull(),
	gender: text(),
	eyeColor: text("eye_color"),
	hairStyle: text("hair_style"),
	physicalDescription: text("physical_description"),
	personalityTraits: text("personality_traits"),
	backstory: text(),
	clothingPrompt: text("clothing_prompt"),
	characterMasterPrompt: text("character_master_prompt"),
	characterNegativePrompt: text("character_negative_prompt"),
	faceReferenceUrl: text("face_reference_url"),
	bodyReferenceUrl: text("body_reference_url"),
	secondaryReferenceUrl: text("secondary_reference_url"),
	voiceId: text("voice_id"),
	voiceProvider: text("voice_provider"),
	faceDescription: text("face_description"),
	hair: text(),
	eyes: text(),
	clothing: text(),
	distinctiveFeatures: text("distinctive_features"),
	psychologicalTraits: text("psychological_traits"),
	background: text(),
	speechStyle: text("speech_style"),
	voice: text(),
	referenceImages: text("reference_images"),
	characterPrompt: text("character_prompt"),
	negativePrompt: text("negative_prompt"),
	role: text(),
	personality: text(),
	behavior: text(),
	speakingStyle: text("speaking_style"),
	appearance: text(),
	wardrobe: text(),
	voiceSettings: text("voice_settings"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const continuityChecks = pgTable("continuity_checks", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	shotId: integer("shot_id"),
	characterMatch: boolean("character_match").default(true),
	clothingMatch: boolean("clothing_match").default(true),
	locationMatch: boolean("location_match").default(true),
	lightingMatch: boolean("lighting_match").default(true),
	dialogueMatch: boolean("dialogue_match").default(true),
	timelineLogic: boolean("timeline_logic").default(true),
	sceneTransitionValid: boolean("scene_transition_valid").default(true),
	decision: text().default('PASS').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "continuity_checks_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shotId],
			foreignColumns: [shots.id],
			name: "continuity_checks_shot_id_shots_id_fk"
		}).onDelete("cascade"),
]);

export const storageBackups = pgTable("storage_backups", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id"),
	backupType: text("backup_type").notNull(),
	storageTarget: text("storage_target").notNull(),
	status: text().default('completed').notNull(),
	fileSizeKey: text("file_size_key"),
	destinationUrl: text("destination_url").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "storage_backups_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const productionJobs = pgTable("production_jobs", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id"),
	provider: text().notNull(),
	status: text().default('QUEUED').notNull(),
	progress: integer().default(0).notNull(),
	retryCount: integer("retry_count").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	type: text().notNull(),
	episodeId: integer("episode_id"),
	shotId: integer("shot_id"),
	providerJobId: text("provider_job_id"),
	input: jsonb().default({}),
	output: jsonb().default({}),
	error: text(),
	maxRetries: integer("max_retries").default(3).notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "production_jobs_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.episodeId],
			foreignColumns: [episodes.id],
			name: "production_jobs_episode_id_episodes_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shotId],
			foreignColumns: [shots.id],
			name: "production_jobs_shot_id_shots_id_fk"
		}).onDelete("cascade"),
]);

export const assets = pgTable("assets", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id"),
	episodeId: integer("episode_id"),
	shotId: integer("shot_id"),
	type: text().notNull(),
	status: text().default('active').notNull(),
	provider: text().notNull(),
	urlPath: text("url_path").notNull(),
	metadata: jsonb().default({}),
	characterId: integer("character_id"),
	worldId: text("world_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "assets_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.episodeId],
			foreignColumns: [episodes.id],
			name: "assets_episode_id_episodes_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shotId],
			foreignColumns: [shots.id],
			name: "assets_shot_id_shots_id_fk"
		}).onDelete("cascade"),
]);

export const seriesSeasons = pgTable("series_seasons", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	seasonNumber: integer("season_number").notNull(),
	title: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "series_seasons_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const seriesEpisodes = pgTable("series_episodes", {
	id: serial().primaryKey().notNull(),
	seasonId: integer("season_id").notNull(),
	episodeNumber: integer("episode_number").notNull(),
	title: text().notNull(),
	summary: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.seasonId],
			foreignColumns: [seriesSeasons.id],
			name: "series_episodes_season_id_series_seasons_id_fk"
		}).onDelete("cascade"),
]);

export const episodes = pgTable("episodes", {
	id: serial().primaryKey().notNull(),
	seasonId: integer("season_id").notNull(),
	episodeNumber: integer("episode_number").notNull(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	projectId: integer("project_id"),
}, (table) => [
	foreignKey({
			columns: [table.seasonId],
			foreignColumns: [seasons.id],
			name: "episodes_season_id_seasons_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "episodes_project_id_projects_id_fk"
		}).onDelete("set null"),
]);

export const seasons = pgTable("seasons", {
	id: serial().primaryKey().notNull(),
	seriesId: integer("series_id").notNull(),
	seasonNumber: integer("season_number").notNull(),
	title: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.seriesId],
			foreignColumns: [series.id],
			name: "seasons_series_id_series_id_fk"
		}).onDelete("cascade"),
]);

export const series = pgTable("series", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	worldId: text("world_id").notNull(),
	synopsis: text(),
	style: text().default('drama').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});
