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

export function createApp(
  database?: D1Database,
  bucket?: R2Bucket,
  r2AccessKeyId?: string,
  r2SecretAccessKey?: string,
  r2Endpoint?: string
) {
  const app = new OpenAPIHono();

  // Initialize services
  const eventPublisher = new EventPublisher();

  const showRepository = new ShowRepository(database);
  const showService = new ShowService(showRepository, eventPublisher);

  const episodeRepository = new EpisodeRepository(database);
  const episodeService = new EpisodeService(episodeRepository, eventPublisher);

  const audioService = new AudioService(
    database,
    bucket,
    eventPublisher,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Endpoint
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

  // All other routes require authentication
  app.use("/shows/*", authMiddleware);
  app.use("/tasks/*", authMiddleware);

  // Register API routes
  registerShowRoutes(app, showService, audioService, imageService);
  registerEpisodeRoutes(app, episodeService, audioService, imageService);
  registerAudioRoutes(app, audioService);
  app.route("/", createTaskRoutes(database));

  return app;
}
