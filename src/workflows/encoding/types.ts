import { z } from "zod";
import type { CloudflareEnv } from "../../types/env";

// Workflow parameters schema
export const EncodingParamsSchema = z.object({
  episodeId: z.string().describe("Episode ID to encode audio for"),
  audioR2Key: z.string().describe("R2 key for the uploaded audio file"),
  encodingFormats: z
    .array(z.string())
    .describe("Formats to encode (e.g., ['mp3_128', 'mp3_192'])"),
  taskId: z.string().optional().describe("Task ID for progress tracking"),
  workflowId: z.string().optional().describe("Workflow ID for tracking"),
  organizationId: z.string().describe("Organization ID for the episode"),
});

export type EncodingParams = z.infer<typeof EncodingParamsSchema>;

// Workflow state
export interface WorkflowState {
  episodeId: string;
  audioR2Key: string;
  encodingFormats: string[];
  taskId?: string;
  workflowId?: string;
  organizationId: string;
  startedAt: string;
}

// Encoding result
export interface EncodingResult {
  format: string;
  bitrate: number;
  r2Key: string;
  metadataR2Key: string;
  duration: number;
  size: number;
}

// Re-export CloudflareEnv as Env for backward compatibility
export type { CloudflareEnv as Env } from "../../types/env";
