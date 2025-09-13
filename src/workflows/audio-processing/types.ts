import { z } from "zod";

// Enhanced workflow environment bindings
export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  ENCODING_CONTAINER: DurableObjectNamespace;
  AUDIO_PROCESSING_WORKFLOW: Workflow;
  // Secrets
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  STORAGE_SIGNATURE_SECRET: string;
  SERVICE_BASE_URL?: string; // Base URL for the service (e.g., https://your-worker.workers.dev)
};

// Zod schemas for validation
export const AudioProcessingParamsSchema = z.object({
  episodeId: z.string().min(1, "Episode ID is required"),
  audioR2Key: z.string().min(1, "Audio R2 key is required"),
  chunkDuration: z.number().positive().optional().default(30),
  overlapDuration: z.number().positive().optional().default(2),
  encodingFormats: z.array(z.string()).optional().default(["mp3_128"]),
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
  transcriptionLanguage: z.string().optional().default("en"),
});

export const WorkflowStateSchema = z.object({
  workflowId: z.string().uuid(),
  episodeId: z.string(),
  audioR2Key: z.string(),
  chunkDuration: z.number().positive(),
  overlapDuration: z.number().positive(),
  encodingFormats: z.array(z.string()),
  startedAt: z.string().datetime(),
  taskId: z.string().optional(),
  transcriptionLanguage: z.string(),
  previewDownloadUrl: z.string().url(),
});

export const EncodedAudioSchema = z.object({
  encodedR2Key: z.string(),
  encodedAudioUrl: z.string().url(),
  duration: z.number().positive(),
  signedUrls: z.array(z.string().url()).optional(),
});

export const AudioMetadataSchema = z.object({
  duration: z.number().positive(),
  expectedChunks: z.number().positive(),
  chunkUploadUrls: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      r2Key: z.string(),
      uploadUrl: z.string().url(),
    })
  ),
  encodedAudioUrl: z.string().url(),
  encodedR2Key: z.string(),
  signedUrls: z.array(z.string().url()).optional(),
});

export const ChunkingResultSchema = z.object({
  chunks: z.array(z.string().url()),
  signedUrls: z.array(z.string().url()).optional(),
});

export const EncodingResultSchema = z.object({
  format: z.string(),
  bitrate: z.number().positive(),
  r2Key: z.string(),
  size: z.number().positive(),
  duration: z.number().positive().optional(),
  signedUrls: z.array(z.string().url()).optional(),
});

export const AudioChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  duration: z.number().positive(),
  chunkId: z.string().optional(),
  r2Key: z.string(),
  metadata: z
    .object({
      format: z.string(),
      bitrate: z.number().positive(),
      size: z.number().positive(),
      channels: z.number().positive(),
      sampleRate: z.number().positive(),
    })
    .optional(),
});

export const TranscribedChunkSchema = z.object({
  text: z.string(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
});

export const StepOutputSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  signedUrls: z.array(z.string().url()).optional(),
  error: z.string().optional(),
});

// Enhanced workflow input parameters
// Type inference from Zod schemas
export type AudioProcessingParams = z.infer<typeof AudioProcessingParamsSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type EncodedAudio = z.infer<typeof EncodedAudioSchema>;
export type AudioMetadata = z.infer<typeof AudioMetadataSchema>;
export type ChunkingResult = z.infer<typeof ChunkingResultSchema>;
export type EncodingResult = z.infer<typeof EncodingResultSchema>;
export type AudioChunk = z.infer<typeof AudioChunkSchema>;
export type TranscribedChunk = z.infer<typeof TranscribedChunkSchema>;
export type StepOutput = z.infer<typeof StepOutputSchema>;

// Base workflow step interface
export interface WorkflowStep<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
  validateInput(input: unknown): TInput;
  validateOutput(output: unknown): TOutput;
}
