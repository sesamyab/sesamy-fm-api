import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskService } from "../tasks/service";

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
        "POST /encoding/test - Test encoding with sample audio",
        "POST /encoding/encode - Encode provided audio URL",
        "POST /encoding/batch - Batch encode multiple files",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // Test encoding endpoint (no auth required) - uses actual container encoding
  app.post("/encoding/test", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    // Use provided URL or default test audio
    const defaultTestAudio =
      "https://podcast-media.sesamy.dev/audio/b0253f27-f247-46be-a9df-df7fbc1bc437/0a215bd9-65a5-4e71-9566-860ea84da493/2b6418e9-ea7c-42b1-ab63-0ac70d662e71/8f7cd1ff-dfcd-4184-bff1-bcf776c80b92.mp3";
    const audioUrl = body.audioUrl || defaultTestAudio;
    const outputFormat = body.outputFormat || "mp3";
    const bitrate = body.bitrate || 128;

    // Create a test session ID for the container
    const sessionId = `test-${Date.now()}`;
    const containerId = encodingContainer.idFromName(sessionId);
    const container = encodingContainer.get(containerId);

    // Create the request payload for the container
    const containerRequest = new Request(
      c.req.url.replace("/encoding/test", "/test"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioUrl: audioUrl,
          outputFormat: outputFormat,
          bitrate: bitrate,
          episodeId: `test-encode-${Date.now()}`,
        }),
      }
    );

    try {
      // Forward the request to the encoding container
      const containerResponse = await container.fetch(containerRequest);
      const result = await containerResponse.json();

      // Return the container's response with additional test info
      return c.json(
        {
          success: containerResponse.ok,
          message: containerResponse.ok
            ? "Test encoding completed successfully using container"
            : "Test encoding failed",
          result: result,
          testInfo: {
            audioUrl: audioUrl,
            outputFormat: outputFormat,
            bitrate: bitrate,
            sessionId: sessionId,
            containerUsed: true,
          },
        },
        containerResponse.ok ? 200 : 500
      );
    } catch (error) {
      console.error("Container encoding failed:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          testInfo: {
            audioUrl,
            outputFormat,
            bitrate,
            sessionId,
            containerUsed: true,
          },
        },
        500
      );
    }
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
