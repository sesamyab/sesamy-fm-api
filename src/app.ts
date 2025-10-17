import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { registerComponent } from "hono-openapi-middlewares";

import { errorHandler } from "./common/errors";
import type { AppContext } from "./auth/types";
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
import { createAuthMiddleware } from "./auth/authentication";

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
  const app = new OpenAPIHono<AppContext>();

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
  app.get("/", (ctx) => {
    return ctx.json({
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

  // Register the Bearer security component
  app.use(registerComponent(app));

  // Create auth middleware
  app.use("*", createAuthMiddleware(app, { logLevel: "info" }));

  // Storage routes for signed file operations (no auth required)
  app.route("/storage", storageRoutes);

  // Health routes (no auth required)
  registerHealthRoutes(app, database);

  // RSS feeds don't require authentication (public access)
  registerFeedRoutes(app, showService, episodeRepository);

  // Register organization routes
  registerOrganizationRoutes(app, organizationService);

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
