import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "hono";
import { getDatabase, type Database } from "../database/client";
import { sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";

const healthSchema = z.object({
  status: z.enum(["healthy", "unhealthy"]),
  timestamp: z.string().datetime(),
  service: z.string(),
  version: z.string(),
});

// Liveness probe
const livenessRoute = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["health"],
  summary: "Liveness probe",
  description: "Check if the service is alive",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: healthSchema,
        },
      },
      description: "Service is alive",
    },
  },
});

// Readiness probe
const readinessRoute = createRoute({
  method: "get",
  path: "/readyz",
  tags: ["health"],
  summary: "Readiness probe",
  description: "Check if the service is ready to serve requests",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: healthSchema,
        },
      },
      description: "Service is ready",
    },
    503: {
      content: {
        "application/json": {
          schema: healthSchema,
        },
      },
      description: "Service is not ready",
    },
  },
});

export function registerHealthRoutes<T extends Env = any>(
  app: OpenAPIHono<T>,
  database?: D1Database
) {
  const db = getDatabase(database);

  // --------------------------------
  // GET /healthz
  // --------------------------------
  app.openapi(livenessRoute, async (ctx) => {
    return ctx.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "podcast-service",
      version: "1.0.0",
    });
  });

  // --------------------------------
  // GET /readyz
  // --------------------------------
  app.openapi(readinessRoute, async (ctx) => {
    try {
      // Check database connection
      await db.run(sql`SELECT 1`);

      return ctx.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "podcast-service",
        version: "1.0.0",
      });
    } catch (error) {
      return ctx.json(
        {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          service: "podcast-service",
          version: "1.0.0",
        },
        503
      );
    }
  });
}
