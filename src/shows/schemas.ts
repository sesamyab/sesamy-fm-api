import { z } from "zod";

// Request schemas
export const CreateShowSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title too long"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(2000, "Description too long"),
  imageUrl: z.nullable(z.string().url()).optional(),
  language: z.string().optional(),
  categories: z.array(z.string()).optional(),
  author: z.string().optional(),
});

export const UpdateShowSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(2000).optional(),
  imageUrl: z.nullable(z.string().url()).optional(),
  language: z.string().optional(),
  categories: z.array(z.string()).optional(),
  author: z.string().optional(),
});

// Response schemas
export const ShowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  language: z.string().nullable(),
  categories: z.array(z.string()).nullable(),
  author: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

// Path parameters
export const ShowParamsSchema = z.object({
  show_id: z.string().uuid(),
});

// Import show from RSS schema
export const ImportShowFromRSSSchema = z.object({
  rssUrl: z.string().url("Invalid RSS URL"),
  maxEpisodes: z.number().int().positive().optional().default(100),
  skipExistingEpisodes: z.boolean().optional().default(false),
});

// Import show response schema
export const ImportShowResponseSchema = z.object({
  taskId: z.string(),
  message: z.string(),
  workflowId: z.string(),
});

// RSS preview request schema
export const RSSPreviewRequestSchema = z.object({
  rssUrl: z.string().url("Invalid RSS URL"),
});

// RSS preview response schema
export const RSSPreviewResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      title: z.string(),
      description: z.string(),
      imageUrl: z.string().nullable().optional(),
      language: z.string().optional(),
      categories: z.array(z.string()).optional(),
      author: z.string().optional(),
      totalEpisodes: z.number().int().nonnegative(),
      episodes: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          audioUrl: z.string().url(),
          imageUrl: z.string().url().nullable().optional(),
          publishedAt: z.string().datetime().nullable().optional(),
          duration: z.number().positive().nullable().optional(),
          episodeNumber: z.number().int().positive().nullable().optional(),
          seasonNumber: z.number().int().positive().nullable().optional(),
        })
      ),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        type: z.string(),
        message: z.string(),
        details: z.any().optional(),
      })
    )
    .optional(),
});

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

// Types
export type CreateShow = z.infer<typeof CreateShowSchema>;
export type UpdateShow = z.infer<typeof UpdateShowSchema>;
export type ImageUpload = z.infer<typeof ImageUploadSchema>;
export type Show = z.infer<typeof ShowSchema>;
export type ShowParams = z.infer<typeof ShowParamsSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
