import { z } from "zod";

// Request schemas
export const CreateEpisodeSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title too long"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(2000, "Description too long"),
  imageUrl: z.nullable(z.string().url()).optional(),
  audioUrl: z.nullable(z.string().url()).optional(),
  transcriptUrl: z.nullable(z.string().url()).optional(),
  duration: z.number().int().positive().nullable().optional(),
  episodeNumber: z.number().int().nonnegative().nullable().optional(),
  seasonNumber: z.number().int().nonnegative().nullable().optional(),
  episodeType: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  explicit: z.boolean().nullable().optional(),
  keywords: z.string().nullable().optional(), // JSON string containing array of keywords
});

export const UpdateEpisodeSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(2000).optional(),
  imageUrl: z.nullable(z.string().url()).optional(),
  audioUrl: z.nullable(z.string().url()).optional(),
  transcriptUrl: z.nullable(z.string().url()).optional(),
  encodedAudioUrls: z.nullable(z.string()).optional(),
  duration: z.number().int().positive().nullable().optional(),
  episodeNumber: z.number().int().nonnegative().nullable().optional(),
  seasonNumber: z.number().int().nonnegative().nullable().optional(),
  episodeType: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  explicit: z.boolean().nullable().optional(),
  keywords: z.string().nullable().optional(), // JSON string containing array of keywords
});

// Response schemas
export const EpisodeSchema = z.object({
  id: z.string().uuid(),
  showId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  audioUrl: z.string().nullable(),
  transcriptUrl: z.string().nullable(),
  encodedAudioUrls: z.string().nullable(),
  published: z.boolean().nullable(),
  publishedAt: z.string().datetime().nullable(),
  duration: z.number().int().positive().nullable(),
  episodeNumber: z.number().int().nonnegative().nullable(),
  seasonNumber: z.number().int().nonnegative().nullable(),
  episodeType: z.string().nullable(),
  author: z.string().nullable(),
  subtitle: z.string().nullable(),
  explicit: z.boolean().nullable(),
  keywords: z.string().nullable(), // JSON string containing array of keywords
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Path parameters
export const EpisodeParamsSchema = z.object({
  show_id: z.string().uuid(),
  episode_id: z.string().uuid(),
});

export const ShowParamsSchema = z.object({
  show_id: z.string().uuid(),
});

// Pagination
export const PaginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => Math.min(parseInt(val || "10"), 100))
    .pipe(z.number().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((val) => parseInt(val || "0"))
    .pipe(z.number().min(0)),
});

// Types
export type CreateEpisode = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisode = z.infer<typeof UpdateEpisodeSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type EpisodeParams = z.infer<typeof EpisodeParamsSchema>;
export type ShowParams = z.infer<typeof ShowParamsSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;

// Image upload response schema
export const ImageUploadSchema = z.object({
  id: z.string().uuid(),
  showId: z.string().uuid().nullable(),
  episodeId: z.string().uuid().nullable(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  url: z.string(),
  uploadedAt: z.string().datetime(),
});

export type ImageUpload = z.infer<typeof ImageUploadSchema>;
