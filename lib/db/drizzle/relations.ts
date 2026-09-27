import { relations } from "drizzle-orm/relations";
import { projects, shots, scripts, worldProfiles, productionTasks, editClips, projectActors, actors, continuityChecks, storageBackups, productionJobs, episodes, assets, seriesSeasons, seriesEpisodes, seasons, series } from "./schema";

export const shotsRelations = relations(shots, ({one, many}) => ({
	project: one(projects, {
		fields: [shots.projectId],
		references: [projects.id]
	}),
	script: one(scripts, {
		fields: [shots.scriptId],
		references: [scripts.id]
	}),
	continuityChecks: many(continuityChecks),
	productionJobs: many(productionJobs),
	assets: many(assets),
}));

export const projectsRelations = relations(projects, ({many}) => ({
	shots: many(shots),
	worldProfiles: many(worldProfiles),
	productionTasks: many(productionTasks),
	scripts: many(scripts),
	editClips: many(editClips),
	projectActors: many(projectActors),
	continuityChecks: many(continuityChecks),
	storageBackups: many(storageBackups),
	productionJobs: many(productionJobs),
	assets: many(assets),
	seriesSeasons: many(seriesSeasons),
	episodes: many(episodes),
}));

export const scriptsRelations = relations(scripts, ({one, many}) => ({
	shots: many(shots),
	project: one(projects, {
		fields: [scripts.projectId],
		references: [projects.id]
	}),
}));

export const worldProfilesRelations = relations(worldProfiles, ({one}) => ({
	project: one(projects, {
		fields: [worldProfiles.projectId],
		references: [projects.id]
	}),
}));

export const productionTasksRelations = relations(productionTasks, ({one}) => ({
	project: one(projects, {
		fields: [productionTasks.projectId],
		references: [projects.id]
	}),
}));

export const editClipsRelations = relations(editClips, ({one}) => ({
	project: one(projects, {
		fields: [editClips.projectId],
		references: [projects.id]
	}),
}));

export const projectActorsRelations = relations(projectActors, ({one}) => ({
	project: one(projects, {
		fields: [projectActors.projectId],
		references: [projects.id]
	}),
	actor: one(actors, {
		fields: [projectActors.actorId],
		references: [actors.id]
	}),
}));

export const actorsRelations = relations(actors, ({many}) => ({
	projectActors: many(projectActors),
}));

export const continuityChecksRelations = relations(continuityChecks, ({one}) => ({
	project: one(projects, {
		fields: [continuityChecks.projectId],
		references: [projects.id]
	}),
	shot: one(shots, {
		fields: [continuityChecks.shotId],
		references: [shots.id]
	}),
}));

export const storageBackupsRelations = relations(storageBackups, ({one}) => ({
	project: one(projects, {
		fields: [storageBackups.projectId],
		references: [projects.id]
	}),
}));

export const productionJobsRelations = relations(productionJobs, ({one}) => ({
	project: one(projects, {
		fields: [productionJobs.projectId],
		references: [projects.id]
	}),
	episode: one(episodes, {
		fields: [productionJobs.episodeId],
		references: [episodes.id]
	}),
	shot: one(shots, {
		fields: [productionJobs.shotId],
		references: [shots.id]
	}),
}));

export const episodesRelations = relations(episodes, ({one, many}) => ({
	productionJobs: many(productionJobs),
	assets: many(assets),
	season: one(seasons, {
		fields: [episodes.seasonId],
		references: [seasons.id]
	}),
	project: one(projects, {
		fields: [episodes.projectId],
		references: [projects.id]
	}),
}));

export const assetsRelations = relations(assets, ({one}) => ({
	project: one(projects, {
		fields: [assets.projectId],
		references: [projects.id]
	}),
	episode: one(episodes, {
		fields: [assets.episodeId],
		references: [episodes.id]
	}),
	shot: one(shots, {
		fields: [assets.shotId],
		references: [shots.id]
	}),
}));

export const seriesSeasonsRelations = relations(seriesSeasons, ({one, many}) => ({
	project: one(projects, {
		fields: [seriesSeasons.projectId],
		references: [projects.id]
	}),
	seriesEpisodes: many(seriesEpisodes),
}));

export const seriesEpisodesRelations = relations(seriesEpisodes, ({one}) => ({
	seriesSeason: one(seriesSeasons, {
		fields: [seriesEpisodes.seasonId],
		references: [seriesSeasons.id]
	}),
}));

export const seasonsRelations = relations(seasons, ({one, many}) => ({
	episodes: many(episodes),
	series: one(series, {
		fields: [seasons.seriesId],
		references: [series.id]
	}),
}));

export const seriesRelations = relations(series, ({many}) => ({
	seasons: many(seasons),
}));