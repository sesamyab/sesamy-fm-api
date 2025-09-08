/**
 * Cloudflare Workers entry point for Podcast Service
 * Optimized for edge runtime with minimal cold start overhead
 */

/// <reference types="@cloudflare/workers-types" />

import { createApp } from "./app";
import { TaskProcessor } from "./tasks/processor";
import { EncodingContainer } from "./encoding/container";

// Interface for Cloudflare Worker environment
interface CloudflareEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  JWT_SECRET?: string;
  NODE_ENV?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string; // Full R2 endpoint URL with account ID
  TASK_QUEUE?: Queue;
  ENCODING_CONTAINER: DurableObjectNamespace;
}

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
      env.AI,
      env.TASK_QUEUE,
      env.ENCODING_CONTAINER
    ); // Set environment variables for JWT
    if (env.JWT_SECRET && !process.env.JWT_SECRET) {
      process.env.JWT_SECRET = env.JWT_SECRET;
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
    const taskProcessor = new TaskProcessor(
      env.DB,
      env.BUCKET,
      env.AI,
      env.TASK_QUEUE,
      env.ENCODING_CONTAINER,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_ENDPOINT
    );
    await taskProcessor.handleScheduledTask(event);
  },
  async queue(
    batch: { messages: Array<{ body: any }> },
    env: CloudflareEnv,
    ctx: ExecutionContext
  ) {
    // Process messages from TASK_QUEUE
    const taskProcessor = new TaskProcessor(
      env.DB,
      env.BUCKET,
      env.AI,
      env.TASK_QUEUE,
      env.ENCODING_CONTAINER,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_ENDPOINT
    );
    for (const msg of batch.messages) {
      try {
        const { type, taskId, payload } = msg.body;

        if (taskId) {
          // Process specific task by ID for immediate processing
          await taskProcessor.processSpecificTask(taskId);
        } else {
          // Fallback to batch processing
          await taskProcessor.processTasks(1);
        }
      } catch (err) {
        console.error("Error processing queue message:", err);
      }
    }
  },
};

// Export the EncodingContainer for Cloudflare Workers
export { EncodingContainer };
