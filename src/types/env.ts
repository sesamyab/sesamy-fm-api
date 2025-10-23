/**
 * Cloudflare Worker environment bindings
 * This is the canonical environment type used across all workflows and services
 */

/// <reference types="@cloudflare/workers-types" />

export interface CloudflareEnv {
  // Database
  DB: D1Database;

  // Storage
  BUCKET: R2Bucket;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string; // Full R2 endpoint URL with account ID

  // AI
  AI: Ai;

  // Workflows
  AUDIO_PROCESSING_WORKFLOW?: Workflow;
  IMPORT_SHOW_WORKFLOW?: Workflow;
  TTS_GENERATION_WORKFLOW?: Workflow;
  TRANSCRIPTION_WORKFLOW?: Workflow;
  ENCODING_WORKFLOW?: Workflow;

  // Durable Objects
  ENCODING_CONTAINER: DurableObjectNamespace;
  MULTIPART_UPLOAD_SESSION: DurableObjectNamespace;

  // AWS Lambda encoding service configuration (optional)
  AWS_LAMBDA_ENCODING_URL?: string;
  AWS_LAMBDA_API_KEY?: string;
  ENCODING_SERVICE_PROVIDER?: string;

  // Auth0 configuration
  AUTH0_DOMAIN?: string;
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string;

  // JWT configuration
  JWT_SECRET?: string;
  JWKS_URL: string;

  // TTS configuration
  TTS_DEFAULT_MODEL?: string;
  TTS_DEFAULT_VOICE?: string;

  // Storage signature secret
  STORAGE_SIGNATURE_SECRET?: string;

  // Service configuration
  SERVICE_BASE_URL?: string; // Base URL for the service (e.g., https://your-worker.workers.dev)
  NODE_ENV?: string;

  // Transcription settings
  DEFAULT_TRANSCRIPTION_LANGUAGE?: string; // Language code for transcription (e.g., 'en', 'es', 'fr')
  DEFAULT_TRANSCRIPTION_MODEL?: string; // Default transcription model (e.g., '@cf/deepgram/nova-3')
  USE_NOVA3_FEATURES?: string; // Whether to use nova-3 features ('true' or 'false')
}
