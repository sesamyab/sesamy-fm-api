import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

// Shows table
export const shows = sqliteTable("shows", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Episodes table
export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  showId: text("show_id")
    .notNull()
    .references(() => shows.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  audioUrl: text("audio_url"),
  transcriptUrl: text("transcript_url"),
  published: integer("published", { mode: "boolean" }).default(false),
  publishedAt: text("published_at"),
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
  type: text("type").notNull(), // "transcribe", "encode", "publish", "notification"
  status: text("status").notNull().default("pending"), // "pending", "processing", "done", "failed"
  payload: text("payload"), // JSON string with input data
  result: text("result"), // JSON string with output data
  error: text("error"), // Error message if failed
  attempts: integer("attempts").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Relations
export const showsRelations = relations(shows, ({ many }) => ({
  episodes: many(episodes),
  imageUploads: many(imageUploads),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
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

// Zod schemas for validation
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

// Types
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
