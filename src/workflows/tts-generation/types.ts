import { z } from "zod";

// TTS Generation Parameters
export const TtsGenerationParamsSchema = z.object({
  episodeId: z.string().uuid(),
  scriptUrl: z.string().url(), // URL to the script text
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
  voice: z.string().default("shimmer"), // Deepgram Aura voice
  model: z.string().default("@cf/deepgram/aura-1"), // TTS model
  organizationId: z.string().optional(),
});

export type TtsGenerationParams = z.infer<typeof TtsGenerationParamsSchema>;

// Workflow state
export const WorkflowStateSchema = z.object({
  workflowId: z.string(),
  episodeId: z.string().uuid(),
  scriptUrl: z.string().url(),
  voice: z.string(),
  model: z.string(),
  taskId: z.string().optional(),
  organizationId: z.string().optional(),
  startedAt: z.string(),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// Environment interface for TTS generation
export interface Env {
  DATABASE: D1Database;
  PODCAST_SERVICE_ASSETS: R2Bucket;
  AI: Ai;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
}

// Result from TTS generation step
export const TtsGenerationResultSchema = z.object({
  audioR2Key: z.string(),
  audioUrl: z.string().url(),
  textLength: z.number(),
  estimatedDuration: z.number().optional(),
});

export type TtsGenerationResult = z.infer<typeof TtsGenerationResultSchema>;
