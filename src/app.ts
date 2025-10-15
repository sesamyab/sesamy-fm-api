import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { errorHandler } from "./common/errors";
import { authMiddleware, jwtMiddleware } from "./auth/middleware";
import { registerHealthRoutes } from "./health/routes";
import { registerShowRoutes } from "./shows/routes";
import { registerEpisodeRoutes } from "./episodes/routes";
import { registerAudioRoutes } from "./audio/routes";
import { registerFeedRoutes } from "./feed/routes";
import { createTaskRoutes } from "./tasks/routes";
import { createWorkflowRoutes } from "./workflows/routes";
import storageRoutes from "./storage/routes";
import { createCampaignRoutes } from "./campaigns/routes";
import { registerOrganizationRoutes } from "./organizations/routes";

// Services
import { EventPublisher } from "./events/publisher";
import { ShowRepository } from "./shows/repository";
import { ShowService } from "./shows/service";
import { EpisodeRepository } from "./episodes/repository";
import { EpisodeService } from "./episodes/service";
import { AudioService } from "./audio/service";
import { ImageService } from "./images/service";
import { TaskService } from "./tasks/service";
import { CampaignRepository } from "./campaigns/repository";
import { CampaignService } from "./campaigns/service";
import { CreativeUploadService } from "./campaigns/creative-upload-service";
import { OrganizationService } from "./organizations/service";
import { Auth0Service } from "./auth/auth0-service";

export function createApp(
  database?: D1Database,
  bucket?: R2Bucket,
  r2AccessKeyId?: string,
  r2SecretAccessKey?: string,
  r2Endpoint?: string,
  audioProcessingWorkflow?: Workflow,
  importShowWorkflow?: Workflow,
  auth0Domain?: string,
  auth0ClientId?: string,
  auth0ClientSecret?: string,
  ttsGenerationWorkflow?: Workflow
) {
  const app = new OpenAPIHono();

  // Initialize services
  const eventPublisher = new EventPublisher();

  const showRepository = new ShowRepository(database);
  const showService = new ShowService(showRepository, eventPublisher);

  const episodeRepository = new EpisodeRepository(database);
  const taskService = new TaskService(database, audioProcessingWorkflow);
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

  const campaignRepository = new CampaignRepository(database);
  const campaignService = new CampaignService(
    campaignRepository,
    eventPublisher
  );

  const creativeUploadService =
    bucket && r2AccessKeyId && r2SecretAccessKey && r2Endpoint
      ? new CreativeUploadService(
          database,
          bucket,
          eventPublisher,
          r2AccessKeyId,
          r2SecretAccessKey,
          r2Endpoint
        )
      : undefined;

  // Initialize Auth0 service and organization service
  const auth0Service =
    auth0Domain && auth0ClientId && auth0ClientSecret
      ? new Auth0Service(auth0Domain, auth0ClientId, auth0ClientSecret)
      : undefined;

  const organizationService = new OrganizationService(
    database ? require("./database/client").getDatabase(database) : undefined,
    auth0Service
  );

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
      { name: "campaigns", description: "Advertising campaigns management" },
      { name: "creatives", description: "Campaign creatives management" },
      { name: "tts", description: "Text-to-speech conversion" },
      { name: "testing", description: "Testing endpoints" },
    ],
  });

  // Swagger UI
  app.get("/swagger", swaggerUI({ url: "/openapi.json" }));

  // ===== ROUTES THAT DON'T REQUIRE AUTH =====

  // Storage routes for signed file operations (no auth required)
  app.route("/storage", storageRoutes);

  // Health routes (no auth required)
  registerHealthRoutes(app, database);

  // RSS feeds don't require authentication (public access)
  registerFeedRoutes(app, showService, episodeRepository, audioService);

  // ===== ORGANIZATION ROUTES (REQUIRE ONLY VALID JWT) =====

  // Apply JWT middleware for organizations (no org context required)
  app.use("/organizations", jwtMiddleware);
  app.use("/organizations/*", jwtMiddleware);

  // Register organization routes
  registerOrganizationRoutes(app, organizationService);

  // ===== ALL OTHER ROUTES (REQUIRE JWT + ORGANIZATION CONTEXT) =====

  // Apply full auth middleware (JWT + organization validation)
  app.use("/shows/*", (c, next) => {
    // Skip auth for RSS feed endpoints
    if (c.req.path.endsWith("/feed")) {
      return next();
    }
    return authMiddleware(c, next);
  });
  app.use("/episodes/*", authMiddleware);
  app.use("/audio/*", authMiddleware);
  app.use("/tasks/*", authMiddleware);
  app.use("/workflows/*", authMiddleware);
  app.use("/campaigns/*", authMiddleware);
  app.use("/tts/*", authMiddleware);

  // Apply auth to transcription routes except /transcription/test
  app.use("/transcription/*", (c, next) => {
    // Skip auth for test endpoint
    if (c.req.path === "/transcription/test") {
      return next();
    }
    return authMiddleware(c, next);
  });

  // Apply auth to test routes except /test/tts (for easy testing)
  app.use("/test/*", (c, next) => {
    // Skip auth for TTS test endpoint
    if (c.req.path === "/test/tts") {
      return next();
    }
    return authMiddleware(c, next);
  });

  // Register protected API routes
  registerShowRoutes(
    app,
    showService,
    audioService,
    imageService,
    database,
    importShowWorkflow
  );
  registerEpisodeRoutes(
    app,
    episodeService,
    audioService,
    imageService,
    bucket,
    ttsGenerationWorkflow
  );
  registerAudioRoutes(app, audioService);
  app.route("/", createTaskRoutes(database));
  app.route("/", createWorkflowRoutes());
  app.route(
    "/",
    createCampaignRoutes(campaignService, audioService, creativeUploadService)
  );

  return app;
}
