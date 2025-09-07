/// <reference types="@cloudflare/workers-types" />
import { Container } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
  ENCODING_CONTAINER: DurableObjectNamespace;
}

export class EncodingContainer extends Container<Env> {
  defaultPort = 3000; // Port the container is listening on
  sleepAfter = "10m"; // Stop the instance if requests not sent for 10 minutes

  envVars = {
    NODE_ENV: "production",
    PORT: "3000",
  };

  onStart() {
    console.log("Encoding container successfully started");
  }

  onStop() {
    console.log("Encoding container successfully shut down");
  }

  onError(error: unknown) {
    console.error("Encoding container error:", error);
  }
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "encoding-service",
    timestamp: new Date().toISOString(),
    endpoints: [
      "GET / - Health check",
      "POST /test - Test encoding with sample audio",
      "POST /encode - Encode provided audio URL",
      "POST /batch - Batch encode multiple files",
    ],
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "encoding-service",
    timestamp: new Date().toISOString(),
  });
});

// Route encoding requests to container instances
app.post("/test", async (c) => {
  const sessionId = "test-session";
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

app.post("/encode", async (c) => {
  // Use request body hash or timestamp as session ID for stateless requests
  const body = await c.req.text();
  const sessionId = `encode-${Date.now()}`;
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);

  // Recreate request with the body
  const newRequest = new Request(c.req.url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: body,
  });

  return await container.fetch(newRequest);
});

app.post("/batch", async (c) => {
  const sessionId = `batch-${Date.now()}`;
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

// Catch-all route for other requests
app.all("*", async (c) => {
  return c.json(
    {
      error: "Endpoint not found",
      available_endpoints: [
        "GET / - Health check",
        "POST /test - Test encoding",
        "POST /encode - Encode audio",
        "POST /batch - Batch encode",
      ],
    },
    404
  );
});

export default app;
