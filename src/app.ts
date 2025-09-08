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
import { createEncodingRoutes } from "./encoding/routes";
import { createTranscriptionRoutes } from "./transcription/routes";
import { createWorkflowRoutes } from "./workflows/routes";
import { EncodingContainer } from "./encoding/container";

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
  queue?: Queue,
  encodingContainer?: DurableObjectNamespace,
  audioProcessingWorkflow?: Workflow
) {
  const app = new OpenAPIHono();

  // Initialize services
  const eventPublisher = new EventPublisher();

  const showRepository = new ShowRepository(database);
  const showService = new ShowService(showRepository, eventPublisher);

  const episodeRepository = new EpisodeRepository(database);
  const taskService = new TaskService(
    database,
    bucket,
    ai,
    queue,
    encodingContainer,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Endpoint
  );
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
    audioProcessingWorkflow
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
      { name: "transcription", description: "Audio transcription services" },
    ],
  });

  // Swagger UI
  app.get("/swagger", swaggerUI({ url: "/openapi.json" }));

  // Health routes (no auth required)
  registerHealthRoutes(app, database);

  // RSS feeds don't require authentication (public access)
  registerFeedRoutes(app, showService, episodeRepository, audioService);

  // Encoding routes
  app.route(
    "/",
    createEncodingRoutes(encodingContainer, database, bucket, ai, queue)
  );

  // Transcription routes
  app.route(
    "/",
    createTranscriptionRoutes(
      database,
      bucket,
      ai,
      queue,
      encodingContainer,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2Endpoint
    )
  );

  // All other routes require authentication
  app.use("/shows/*", (c, next) => {
    // Skip auth for RSS feed endpoints
    if (c.req.path.endsWith("/feed")) {
      return next();
    }
    return authMiddleware(c, next);
  });
  app.use("/tasks/*", authMiddleware);
  app.use("/encoding/*", authMiddleware);
  app.use("/workflows/*", authMiddleware);

  // Apply auth to transcription routes except /transcription/test
  app.use("/transcription/*", (c, next) => {
    // Skip auth for test endpoint
    if (c.req.path === "/transcription/test") {
      return next();
    }
    return authMiddleware(c, next);
  });

  // Register API routes
  registerShowRoutes(app, showService, audioService, imageService);
  registerEpisodeRoutes(app, episodeService, audioService, imageService);
  registerAudioRoutes(app, audioService);
  app.route(
    "/",
    createTaskRoutes(
      database,
      bucket,
      ai,
      queue,
      encodingContainer,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2Endpoint
    )
  );
  app.route(
    "/",
    createEncodingRoutes(encodingContainer, database, bucket, ai, queue)
  );
  app.route(
    "/",
    createTranscriptionRoutes(
      database,
      bucket,
      ai,
      queue,
      encodingContainer,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2Endpoint
    )
  );

  app.route("/", createWorkflowRoutes());

  return app;
}
