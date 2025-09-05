/**
 * Cloudflare Workers entry point for Podcast Service
 * Optimized for edge runtime with minimal cold start overhead
 */

/// <reference types="@cloudflare/workers-types" />

import { createApp } from "./app";
import { TaskProcessor } from "./tasks/processor";

// Interface for Cloudflare Worker environment
interface CloudflareEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  JWT_SECRET?: string;
  NODE_ENV?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string; // Full R2 endpoint URL with account ID
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
      env.R2_ENDPOINT
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
    const taskProcessor = new TaskProcessor(env.DB);
    await taskProcessor.handleScheduledTask(event);
  },
};
