import { z } from "zod";

// Zod schema for transcription workflow parameters
export const TranscriptionParamsSchema = z.object({
  episodeId: z.string().uuid(),
  audioUrl: z.string().url(),
  audioR2Key: z.string().optional(), // R2 key if audio is in R2
  taskId: z.string().optional(),
  organizationId: z.string().uuid(),
  language: z.string().default("en"),
  model: z.string().default("whisper-large-v3"),
});

export type TranscriptionParams = z.infer<typeof TranscriptionParamsSchema>;

// Transcription result interface
export interface TranscriptionResult {
  transcriptR2Key: string;
  transcriptUrl: string;
  transcript: string;
  duration?: number;
  wordCount: number;
}

// Workflow state schema
export const WorkflowStateSchema = z.object({
  workflowId: z.string().uuid(),
  episodeId: z.string().uuid(),
  audioUrl: z.string().url(),
  audioR2Key: z.string().optional(),
  taskId: z.string().optional(),
  organizationId: z.string().uuid(),
  language: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// Environment bindings
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  TRANSCRIPTION_WORKFLOW: Workflow;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
}
