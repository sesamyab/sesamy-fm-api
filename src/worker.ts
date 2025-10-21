/**
 * Cloudflare Workers entry point for Podcast Service
 * Optimized for edge runtime with minimal cold start overhead
 */

/// <reference types="@cloudflare/workers-types" />

import { createApp } from "./app";
import { TaskProcessor } from "./tasks/processor";
import { EncodingContainer } from "./encoding/container";
import { AudioProcessingWorkflow } from "./workflows/audio-processing";
import { ImportShowWorkflow } from "./workflows/import-show";
import { TtsGenerationWorkflow } from "./workflows/tts-generation";
import { TranscriptionWorkflow } from "./workflows/transcription";
import { EncodingWorkflow } from "./workflows/encoding";
import type { CloudflareEnv } from "./types/env";

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Create app with D1 database, R2 bucket, and R2 credentials
    const app = createApp(
      env.DB,
      env.BUCKET,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_ENDPOINT,
      env.AUDIO_PROCESSING_WORKFLOW,
      env.IMPORT_SHOW_WORKFLOW,
      env.AUTH0_DOMAIN,
      env.AUTH0_CLIENT_ID,
      env.AUTH0_CLIENT_SECRET,
      env.TTS_GENERATION_WORKFLOW,
      env.ENCODING_WORKFLOW
    ); // Set environment variables for JWT
    if (env.JWT_SECRET && !process.env.JWT_SECRET) {
      process.env.JWT_SECRET = env.JWT_SECRET;
    }
    if (
      env.ENCODING_SERVICE_PROVIDER &&
      !process.env.ENCODING_SERVICE_PROVIDER
    ) {
      process.env.ENCODING_SERVICE_PROVIDER = env.ENCODING_SERVICE_PROVIDER;
    }
    // Don't modify NODE_ENV as it's a compile-time constant in Workers

    return app.fetch(request, env, ctx);
  },

  async scheduled(
    event: ScheduledEvent,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    // Process background tasks
    const taskProcessor = new TaskProcessor(env.DB);
    await taskProcessor.handleScheduledTask(event);
  },

  async queue(
    batch: MessageBatch,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    // Empty queue handler for deployment compatibility
    console.log(`Processing ${batch.messages.length} queue messages`);

    for (const message of batch.messages) {
      try {
        console.log("Processing message:", message.id);
        message.ack();
      } catch (error) {
        console.error("Error processing queue message:", error);
        message.retry();
      }
    }
  },
};

// Export the EncodingContainer, AudioProcessingWorkflow, ImportShowWorkflow, TtsGenerationWorkflow, TranscriptionWorkflow, and EncodingWorkflow for Cloudflare Workers
export {
  EncodingContainer,
  AudioProcessingWorkflow,
  ImportShowWorkflow,
  TtsGenerationWorkflow,
  TranscriptionWorkflow,
  EncodingWorkflow,
};
