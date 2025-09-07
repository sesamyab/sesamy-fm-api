/// <reference types="@cloudflare/workers-types" />

import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { errorHandler } from "./common/errors";
import { authMiddleware } from "./auth/middleware";
import { registerHealthRoutes } from "./health/routes";
import { registerShowRoutes } from "./shows/routes";
import { registerEpisodeRoutes } from "./episodes/routes";
import { registerAudioRoutes } from "./audio/routes";
import { registerFeedRoutes } from "./feed/routes";
import { createTaskRoutes } from "./tasks/routes";

// Services
import { EventPublisher } from "./events/publisher";
import { ShowRepository } from "./shows/repository";
import { ShowService } from "./shows/service";
import { EpisodeRepository } from "./episodes/repository";
import { EpisodeService } from "./episodes/service";
import { AudioRepository } from "./audio/repository";
import { AudioService } from "./audio/service";
import { ImageService } from "./images/service";
import { TaskService } from "./tasks/service";

// Type for encoding service response
interface EncodingServiceResponse {
  success: boolean;
  error?: string;
  metadata?: {
    format?: string;
    bitrate?: number;
    size?: number;
    duration?: number;
  };
  testInfo?: Record<string, any>;
}

export function createApp(
  database?: D1Database,
  bucket?: R2Bucket,
  r2AccessKeyId?: string,
  r2SecretAccessKey?: string,
  r2Endpoint?: string,
  ai?: Ai,
  queue?: Queue
) {
  const app = new OpenAPIHono();

  // Initialize services
  const eventPublisher = new EventPublisher();

  const showRepository = new ShowRepository(database);
  const showService = new ShowService(showRepository, eventPublisher);

  const episodeRepository = new EpisodeRepository(database);
  const taskService = new TaskService(database, bucket, ai, queue);
  const episodeService = new EpisodeService(
    episodeRepository,
    eventPublisher,
    taskService
  );

  const audioService = new AudioService(
    database,
    bucket,
    eventPublisher,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Endpoint,
    taskService
  );

  const imageService =
    bucket && r2AccessKeyId && r2SecretAccessKey
      ? new ImageService(
          bucket as any,
          r2AccessKeyId,
          r2SecretAccessKey,
          r2Endpoint,
          database
        )
      : undefined;

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());

  // Error handler
  app.onError(errorHandler);

  // Service info endpoint
  app.get("/", (c) => {
    return c.json({
      name: "podcast-service",
      version: "1.0.0",
    });
  });

  // OpenAPI JSON endpoint
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Podcast Service API",
      version: "1.0.0",
      description: "Service Standard v1 compliant Podcast Service",
    },
    security: [
      {
        Bearer: [],
      },
    ],
    tags: [
      { name: "health", description: "Health check endpoints" },
      { name: "feeds", description: "RSS feed endpoints (no auth required)" },
      { name: "shows", description: "Podcast shows management" },
      { name: "episodes", description: "Episode management" },
      { name: "audio", description: "Audio file management" },
      { name: "tasks", description: "Background task management" },
    ],
  });

  // Swagger UI
  app.get("/swagger", swaggerUI({ url: "/openapi.json" }));

  // Health routes (no auth required)
  registerHealthRoutes(app, database);

  // RSS feeds don't require authentication (public access)
  registerFeedRoutes(app, showService, episodeRepository, audioService);

  // Test encoding endpoint (no auth required)
  app.post("/tasks/test-encode", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    // Use provided URL or default test audio
    const defaultTestAudio =
      "https://podcast-media.sesamy.dev/audio/b0253f27-f247-46be-a9df-df7fbc1bc437/0a215bd9-65a5-4e71-9566-860ea84da493/2b6418e9-ea7c-42b1-ab63-0ac70d662e71/8f7cd1ff-dfcd-4184-bff1-bcf776c80b92.mp3";
    const audioUrl = body.audioUrl || defaultTestAudio;
    const outputFormat = body.outputFormat || "mp3";
    const bitrate = body.bitrate || 128;

    try {
      // Call the encoding service (now deployed as Cloudflare Container)
      const encodingServiceUrl =
        process.env.ENCODING_SERVICE_URL ||
        "https://encoding-service.sesamy-dev.workers.dev";

      console.log(`Calling encoding service: ${encodingServiceUrl}/test`);

      const response = await fetch(`${encodingServiceUrl}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputFormat, bitrate }),
      });

      if (!response.ok) {
        throw new Error(`Encoding service failed: ${response.statusText}`);
      }

      const result = (await response.json()) as EncodingServiceResponse;

      if (!result.success) {
        throw new Error(`Encoding failed: ${result.error}`);
      }

      return c.json(
        {
          success: true,
          message: "Direct encoding completed successfully",
          result: {
            format: result.metadata?.format || outputFormat,
            bitrate: result.metadata?.bitrate || bitrate,
            size: result.metadata?.size || 0,
            duration: result.metadata?.duration || 0,
            sampleEncoded: true,
          },
          testInfo: {
            ...result.testInfo,
            encodingService: encodingServiceUrl,
            estimatedSize: `${Math.round((bitrate * 60) / 8)} KB`,
          },
        },
        200
      );
    } catch (error) {
      console.error("Test encoding failed:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          testInfo: {
            audioUrl,
            outputFormat,
            bitrate,
          },
        },
        500
      );
    }
  });

  // All other routes require authentication
  app.use("/shows/*", (c, next) => {
    // Skip auth for RSS feed endpoints
    if (c.req.path.endsWith("/feed")) {
      return next();
    }
    return authMiddleware(c, next);
  });
  app.use("/tasks/*", authMiddleware);

  // Register API routes
  registerShowRoutes(app, showService, audioService, imageService);
  registerEpisodeRoutes(app, episodeService, audioService, imageService);
  registerAudioRoutes(app, audioService);
  app.route("/", createTaskRoutes(database, bucket, ai, queue));

  return app;
}
