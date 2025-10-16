import { raw } from "hono/html";
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
  // AWS Lambda encoding service configuration (optional)
  AWS_LAMBDA_ENCODING_URL?: string;
  AWS_LAMBDA_API_KEY?: string;
  ENCODING_SERVICE_PROVIDER?: string; // 'aws' or 'cloudflare'
  // Transcription settings
  DEFAULT_TRANSCRIPTION_LANGUAGE?: string; // Language code for transcription (e.g., 'en', 'es', 'fr')
  DEFAULT_TRANSCRIPTION_MODEL?: string; // Default transcription model (e.g., '@cf/deepgram/nova-3')
  USE_NOVA3_FEATURES?: string; // Whether to use nova-3 features ('true' or 'false')
};

// Zod schemas for validation
export const AudioProcessingParamsSchema = z.object({
  episodeId: z.string().min(1, "Episode ID is required"),
  audioR2Key: z.string().min(1, "Audio R2 key is required"),
  chunkDuration: z.number().positive().optional().default(60),
  overlapDuration: z.number().positive().optional().default(2),
  encodingFormats: z.array(z.string()).optional().default(["mp3_128"]),
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
  transcriptionLanguage: z.string().optional().default("en"),
  transcriptionModel: z.string().optional().default("@cf/deepgram/nova-3"),
  useNova3Features: z.boolean().optional().default(true),
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
  transcriptionModel: z.string(),
  useNova3Features: z.boolean(),
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

export const WordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

// Nova-3 specific schemas
export const Nova3SpeakerSchema = z.object({
  speaker: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
});

export const ChapterSchema = z.object({
  title: z.string(),
  startTime: z.number().nonnegative(),
  endTime: z.number().nonnegative(),
  summary: z.string().optional(),
});

export const TranscribedChunkSchema = z.object({
  words: z.array(WordSchema),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  chunkIndex: z.number().int().nonnegative(),
  raw: z.any(),
  metadata: z
    .object({
      language: z.string().optional(),
      sentiments: z
        .array(
          z.object({
            text: z.string(),
            sentiment: z.enum(["positive", "negative", "neutral"]),
            confidence: z.number(),
            start: z.number(),
            end: z.number(),
          })
        )
        .optional(),
      summary: z.string().optional(),
      speakers: z.array(Nova3SpeakerSchema).optional(),
      keywords: z
        .array(
          z.object({
            keyword: z.string(),
            confidence: z.number(),
            start: z.number(),
            end: z.number(),
          })
        )
        .optional(),
      paragraphs: z
        .array(
          z.object({
            text: z.string(),
            start: z.number(),
            end: z.number(),
            speaker: z.string().optional(),
          })
        )
        .optional(),
      chapters: z.array(ChapterSchema).optional(),
      ttsAudioUrl: z.string().url().optional(), // Add TTS audio URL field
    })
    .optional(),
});

export const EnhancedTranscriptResultSchema = z.object({
  enhancedTranscriptUrl: z.string().url(),
  keywords: z.array(z.string()),
  chapters: z.array(ChapterSchema),
  paragraphs: z.number().positive(),
  summary: z.string().optional(),
});

export const ComprehensiveTranscriptSchema = z.object({
  text: z.string(),
  html: z.string(),
  markdown: z.string(),
  originalWords: z.array(WordSchema),
  totalWords: z.number(),
  totalParagraphs: z.number(),
});

// Nova-3 complete response schema with nested types
export const Nova3ResponseSchema = z.object({
  result: z.object({
    results: z.object({
      channels: z.array(
        z.object({
          alternatives: z.array(
            z.object({
              confidence: z.number(),
              paragraphs: z.object({
                paragraphs: z.array(
                  z.object({
                    end: z.number(),
                    num_words: z.number(),
                    sentences: z.array(
                      z.object({
                        end: z.number(),
                        start: z.number(),
                        text: z.string(),
                      })
                    ),
                    speaker: z.number(),
                    start: z.number(),
                  })
                ),
                transcript: z.string(),
              }),
              transcript: z.string(),
              words: z.array(
                z.object({
                  confidence: z.number(),
                  end: z.number(),
                  punctuated_word: z.string(),
                  speaker: z.number(),
                  speaker_confidence: z.number(),
                  start: z.number(),
                  word: z.string(),
                })
              ),
            })
          ),
          detected_language: z.string(),
          language_confidence: z.number(),
        })
      ),
    }),
    usage: z.object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    }),
  }),
  success: z.boolean(),
  errors: z.array(z.unknown()),
  messages: z.array(z.unknown()),
});

export const Nova3TranscriptionSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  summary: z.string().optional(),
  sentiments: z
    .array(
      z.object({
        text: z.string(),
        sentiment: z.enum(["positive", "negative", "neutral"]),
        confidence: z.number(),
        start: z.number(),
        end: z.number(),
      })
    )
    .optional(),
  speakers: z.array(Nova3SpeakerSchema).optional(),
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        confidence: z.number(),
        start: z.number(),
        end: z.number(),
      })
    )
    .optional(),
  paragraphs: z
    .array(
      z.object({
        text: z.string(),
        start: z.number(),
        end: z.number(),
        speaker: z.string().optional(),
      })
    )
    .optional(),
  words: z.array(WordSchema).optional(),
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
export type Word = z.infer<typeof WordSchema>;
export type TranscribedChunk = z.infer<typeof TranscribedChunkSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type EnhancedTranscriptResult = z.infer<
  typeof EnhancedTranscriptResultSchema
>;
export type ComprehensiveTranscript = z.infer<
  typeof ComprehensiveTranscriptSchema
>;
export type StepOutput = z.infer<typeof StepOutputSchema>;
export type Nova3Speaker = z.infer<typeof Nova3SpeakerSchema>;
export type Nova3Transcription = z.infer<typeof Nova3TranscriptionSchema>;
export type Nova3Response = z.infer<typeof Nova3ResponseSchema>;

// Base workflow step interface
export interface WorkflowStep<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
  validateInput(input: unknown): TInput;
  validateOutput(output: unknown): TOutput;
}
