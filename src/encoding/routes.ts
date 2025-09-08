import { OpenAPIHono } from "@hono/zod-openapi";

export function createEncodingRoutes(
  encodingContainer?: DurableObjectNamespace,
  database?: D1Database,
  bucket?: R2Bucket,
  ai?: Ai,
  queue?: Queue
) {
  const app = new OpenAPIHono();

  // Skip if no encoding container is available
  if (!encodingContainer) {
    app.get("/encoding", (c) => {
      return c.json(
        {
          status: "unavailable",
          service: "encoding-service",
          message: "Encoding container not configured",
        },
        503
      );
    });
    return app;
  }

  // Encoding service health check
  app.get("/encoding", (c) => {
    return c.json({
      status: "ok",
      service: "encoding-service",
      endpoints: [
        "GET /encoding - Health check and available endpoints",
        "POST /encoding/encode - Encode provided audio URL",
        "POST /encoding/batch - Batch encode multiple files",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/encoding/encode", async (c) => {
    const sessionId = `encode-${Date.now()}`;
    const containerId = encodingContainer.idFromName(sessionId);
    const container = encodingContainer.get(containerId);
    return await container.fetch(c.req.raw);
  });

  app.post("/encoding/batch", async (c) => {
    const sessionId = `batch-${Date.now()}`;
    const containerId = encodingContainer.idFromName(sessionId);
    const container = encodingContainer.get(containerId);
    return await container.fetch(c.req.raw);
  });

  return app;
}
