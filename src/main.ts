import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { logger } from "./telemetry/";

const app = createApp();
const port = parseInt(process.env.PORT || "3000");

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    logger.info(`Podcast service started`, {
      port,
      environment: process.env.NODE_ENV || "development",
      service: "podcast-service",
      version: "1.0.0",
    });
  }
);
