import { z } from "zod";

// TTS Generation Parameters
export const TtsGenerationParamsSchema = z.object({
  episodeId: z.string().uuid(),
  scriptUrl: z.string().url(), // URL to the script text
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
  voice: z.string().default("luna"),
  model: z.string().default("@cf/deepgram/aura-1"), // TTS model
  provider: z.enum(["aura", "elevenlabs"]).default("aura"), // TTS provider
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
  provider: z.enum(["aura", "elevenlabs"]),
  taskId: z.string().optional(),
  organizationId: z.string().optional(),
  startedAt: z.string(),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// Enhanced workflow environment bindings for TTS generation workflow
export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  TTS_GENERATION_WORKFLOW: Workflow;
  // Secrets
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  ELEVENLABS_API_KEY: string; // ElevenLabs API key
  STORAGE_SIGNATURE_SECRET?: string;
  SERVICE_BASE_URL?: string; // Base URL for the service (e.g., https://your-worker.workers.dev)
};

// Result from TTS generation step
export const TtsGenerationResultSchema = z.object({
  audioR2Key: z.string(),
  audioUrl: z.string().url(),
  textLength: z.number(),
  estimatedDuration: z.number().optional(),
});

export type TtsGenerationResult = z.infer<typeof TtsGenerationResultSchema>;
