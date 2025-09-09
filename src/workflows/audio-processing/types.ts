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

// Enhanced workflow input parameters
export type AudioProcessingParams = {
  episodeId: string;
  audioR2Key: string; // R2 key instead of direct URL
  chunkDuration?: number;
  overlapDuration?: number;
  encodingFormats?: string[]; // e.g., ['mp3_128'] - bitrate auto-adjusted based on mono/stereo
  taskId?: string;
  transcriptionLanguage?: string; // Force a specific language for transcription (e.g., 'en', 'es', 'fr')
};

// Workflow state interface
export interface WorkflowState {
  workflowId: string;
  episodeId: string;
  audioR2Key: string;
  chunkDuration: number;
  overlapDuration: number;
  encodingFormats: string[];
  startedAt: string;
  taskId?: string;
  transcriptionLanguage: string;
  previewDownloadUrl: string;
}

// Encoded audio result interface
export interface EncodedAudio {
  encodedR2Key: string;
  encodedAudioUrl: string;
  duration: number;
}

// Audio metadata interface
export interface AudioMetadata {
  duration: number;
  expectedChunks: number;
  chunkUploadUrls: Array<{
    index: number;
    r2Key: string;
    uploadUrl: string;
  }>;
  encodedAudioUrl: string;
  encodedR2Key: string;
}

// Chunking result interface
export interface ChunkingResult {
  chunks: string[]; // Array of audio URLs for each chunk
}

// Encoding result interface
export interface EncodingResult {
  format: string;
  bitrate: number;
  r2Key: string; // R2 key instead of URL
  size: number;
  duration?: number;
}

// Chunk interface for processing
export interface AudioChunk {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  chunkId?: string;
  r2Key: string; // R2 storage key for the chunk
  metadata?: {
    format: string;
    bitrate: number;
    size: number;
    channels: number;
    sampleRate: number;
  };
}

// Transcribed chunk interface - simplified with timing
export interface TranscribedChunk {
  text: string;
  startTime: number;
  endTime: number;
}
