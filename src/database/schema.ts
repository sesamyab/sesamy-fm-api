import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

// Organizations table
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(), // This will be the Auth0 organization ID
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Shows table
export const shows = sqliteTable("shows", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  language: text("language"), // Language code (e.g. "en", "es")
  categories: text("categories"), // JSON string containing array of categories
  author: text("author"), // Show author/creator
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Episodes table
export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  showId: text("show_id")
    .notNull()
    .references(() => shows.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  audioUrl: text("audio_url"),
  transcriptUrl: text("transcript_url"),
  encodedAudioUrls: text("encoded_audio_urls"), // JSON string containing encoded audio URLs
  published: integer("published", { mode: "boolean" }).default(false),
  publishedAt: text("published_at"),
  duration: integer("duration"), // Duration in seconds
  episodeNumber: integer("episode_number"), // Episode number within season
  seasonNumber: integer("season_number"), // Season number
  episodeType: text("episode_type"), // full, trailer, bonus
  author: text("author"), // Episode-specific author/narrator
  subtitle: text("subtitle"), // iTunes subtitle
  explicit: integer("explicit", { mode: "boolean" }), // Explicit content flag
  keywords: text("keywords"), // JSON string containing array of keywords/tags
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Audio uploads table
export const audioUploads = sqliteTable("audio_uploads", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  url: text("url").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
});

// Image uploads table
export const imageUploads = sqliteTable("image_uploads", {
  id: text("id").primaryKey(),
  showId: text("show_id").references(() => shows.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  url: text("url").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
});

// Tasks table for background job processing
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // "transcribe", "encode", "publish", "notification", "audio_processing"
  status: text("status").notNull().default("pending"), // "pending", "processing", "done", "failed", "retry"
  payload: text("payload"), // JSON string with input data
  result: text("result"), // JSON string with output data
  error: text("error"), // Error message if failed
  attempts: integer("attempts").default(0),
  startedAt: text("started_at"), // When task processing actually started
  progress: integer("progress").default(0), // Progress percentage (0-100)
  step: text("step"), // Current step description (e.g., "2/10 Encoding audio for processing")
  workflowId: text("workflow_id"), // Associated workflow instance ID
  workflowInstanceId: text("workflow_instance_id"), // Cloudflare workflow instance ID
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Workflows table to track workflow instances
export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  taskId: integer("task_id").references(() => tasks.id, {
    onDelete: "cascade",
  }),
  workflowName: text("workflow_name").notNull(),
  instanceId: text("instance_id").notNull(), // Cloudflare workflow instance ID
  status: text("status").notNull().default("queued"), // "queued", "running", "paused", "completed", "failed", "cancelled", "terminated"
  episodeId: text("episode_id"),
  metadata: text("metadata"), // JSON string with workflow metadata
  progress: text("progress"), // JSON string with step progress
  estimatedProgress: integer("estimated_progress").default(0), // Overall progress percentage (0-100)
  estimatedDuration: text("estimated_duration"),
  actualDuration: integer("actual_duration"), // Duration in seconds
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

// Campaigns table
export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  advertiser: text("advertiser"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  targetImpressions: integer("target_impressions"),
  priority: integer("priority").notNull().default(5), // Lower number = higher priority
  status: text("status", { enum: ["draft", "active", "paused", "ended"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Creatives table
export const creatives = sqliteTable("creatives", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["audio", "video", "display"] })
    .notNull()
    .default("audio"),
  audioUrl: text("audio_url"),
  imageUrl: text("image_url"),
  duration: integer("duration"), // Length in seconds
  placementType: text("placement_type", { enum: ["pre", "mid", "post", "any"] })
    .notNull()
    .default("any"),
  language: text("language"), // Optional (e.g. "en", "es")
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Campaign-Show junction table for many-to-many relationship
export const campaignShows = sqliteTable("campaign_shows", {
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  showId: text("show_id")
    .notNull()
    .references(() => shows.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  shows: many(shows),
  campaigns: many(campaigns),
  tasks: many(tasks),
}));

export const showsRelations = relations(shows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [shows.organizationId],
    references: [organizations.id],
  }),
  episodes: many(episodes),
  imageUploads: many(imageUploads),
  campaignShows: many(campaignShows),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [episodes.organizationId],
    references: [organizations.id],
  }),
  show: one(shows, {
    fields: [episodes.showId],
    references: [shows.id],
  }),
  audioUploads: many(audioUploads),
  imageUploads: many(imageUploads),
}));

export const audioUploadsRelations = relations(audioUploads, ({ one }) => ({
  episode: one(episodes, {
    fields: [audioUploads.episodeId],
    references: [episodes.id],
  }),
}));

export const imageUploadsRelations = relations(imageUploads, ({ one }) => ({
  show: one(shows, {
    fields: [imageUploads.showId],
    references: [shows.id],
  }),
  episode: one(episodes, {
    fields: [imageUploads.episodeId],
    references: [episodes.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  organization: one(organizations, {
    fields: [tasks.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [tasks.id],
    references: [workflows.taskId],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one }) => ({
  task: one(tasks, {
    fields: [workflows.taskId],
    references: [tasks.id],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [campaigns.organizationId],
    references: [organizations.id],
  }),
  creatives: many(creatives),
  campaignShows: many(campaignShows),
}));

export const creativesRelations = relations(creatives, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [creatives.campaignId],
    references: [campaigns.id],
  }),
}));

export const campaignShowsRelations = relations(campaignShows, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignShows.campaignId],
    references: [campaigns.id],
  }),
  show: one(shows, {
    fields: [campaignShows.showId],
    references: [shows.id],
  }),
}));

// Zod schemas for validation
export const insertOrganizationSchema = createInsertSchema(organizations);
export const selectOrganizationSchema = createSelectSchema(organizations);

export const insertShowSchema = createInsertSchema(shows);
export const selectShowSchema = createSelectSchema(shows);

export const insertEpisodeSchema = createInsertSchema(episodes);
export const selectEpisodeSchema = createSelectSchema(episodes);

export const insertAudioUploadSchema = createInsertSchema(audioUploads);
export const selectAudioUploadSchema = createSelectSchema(audioUploads);

export const insertImageUploadSchema = createInsertSchema(imageUploads);
export const selectImageUploadSchema = createSelectSchema(imageUploads);

export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);

export const insertWorkflowSchema = createInsertSchema(workflows);
export const selectWorkflowSchema = createSelectSchema(workflows);

export const insertCampaignSchema = createInsertSchema(campaigns);
export const selectCampaignSchema = createSelectSchema(campaigns);

export const insertCreativeSchema = createInsertSchema(creatives);
export const selectCreativeSchema = createSelectSchema(creatives);

export const insertCampaignShowSchema = createInsertSchema(campaignShows);
export const selectCampaignShowSchema = createSelectSchema(campaignShows);

// Types
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;

export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;

export type AudioUpload = typeof audioUploads.$inferSelect;
export type NewAudioUpload = typeof audioUploads.$inferInsert;

export type ImageUpload = typeof imageUploads.$inferSelect;
export type NewImageUpload = typeof imageUploads.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Creative = typeof creatives.$inferSelect;
export type NewCreative = typeof creatives.$inferInsert;

export type CampaignShow = typeof campaignShows.$inferSelect;
export type NewCampaignShow = typeof campaignShows.$inferInsert;
