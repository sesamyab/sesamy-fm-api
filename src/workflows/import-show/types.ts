import { z } from "zod";

// Enhanced workflow environment bindings for import-show workflow
export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  ENCODING_CONTAINER: DurableObjectNamespace;
  IMPORT_SHOW_WORKFLOW: Workflow;
  AUDIO_PROCESSING_WORKFLOW: Workflow;
  // Secrets
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  STORAGE_SIGNATURE_SECRET: string;
  SERVICE_BASE_URL?: string; // Base URL for the service (e.g., https://your-worker.workers.dev)
};

// RSS Episode structure
export const RSSEpisodeSchema = z.object({
  title: z.string(),
  description: z.string(),
  audioUrl: z.string().url(),
  imageUrl: z.string().url().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  duration: z.number().positive().nullable().optional(),
  episodeNumber: z.number().int().nonnegative().nullable().optional(),
  seasonNumber: z.number().int().nonnegative().nullable().optional(),
  episodeType: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  explicit: z.boolean().nullable().optional(),
  keywords: z.array(z.string()).nullable().optional(),
});

// RSS Show structure
export const RSSShowSchema = z.object({
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().url().nullable().optional(),
  language: z.string().optional(),
  categories: z.array(z.string()).optional(),
  author: z.string().optional(),
  episodes: z.array(RSSEpisodeSchema),
});

// Import Show Parameters Schema
export const ImportShowParamsSchema = z.object({
  rssUrl: z.string().url("Invalid RSS URL"),
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
  skipExistingEpisodes: z.boolean().optional().default(false),
  maxEpisodes: z.number().int().positive().optional().default(100),
});

// Workflow State Schema
export const ImportShowWorkflowStateSchema = z.object({
  workflowId: z.string().uuid(),
  rssUrl: z.string().url(),
  taskId: z.string().optional(),
  startedAt: z.string().datetime(),
  skipExistingEpisodes: z.boolean(),
  maxEpisodes: z.number().int().positive(),
  showId: z.string().uuid().optional(), // Set after show creation
  totalEpisodes: z.number().int().nonnegative().optional(),
  processedEpisodes: z.number().int().nonnegative().optional().default(0),
});

// Episode Processing Result Schema
export const EpisodeProcessingResultSchema = z.object({
  episodeId: z.string().uuid(),
  title: z.string(),
  status: z.enum(["created", "skipped", "failed"]),
  error: z.string().optional(),
  audioR2Key: z.string().optional(),
  audioProcessingTaskId: z.string().optional(),
});

// Show Creation Result Schema
export const ShowCreationResultSchema = z.object({
  showId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable().optional(),
  totalEpisodes: z.number().int().nonnegative(),
});

// Type exports
export type ImportShowParams = z.infer<typeof ImportShowParamsSchema>;
export type ImportShowWorkflowState = z.infer<
  typeof ImportShowWorkflowStateSchema
>;
export type RSSShow = z.infer<typeof RSSShowSchema>;
export type RSSEpisode = z.infer<typeof RSSEpisodeSchema>;
export type EpisodeProcessingResult = z.infer<
  typeof EpisodeProcessingResultSchema
>;
export type ShowCreationResult = z.infer<typeof ShowCreationResultSchema>;
