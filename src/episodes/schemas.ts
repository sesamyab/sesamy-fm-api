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
});

export const UpdateEpisodeSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(2000).optional(),
  imageUrl: z.nullable(z.string().url()).optional(),
  audioUrl: z.nullable(z.string().url()).optional(),
  transcriptUrl: z.nullable(z.string().url()).optional(),
  encodedAudioUrls: z.nullable(z.string()).optional(),
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
