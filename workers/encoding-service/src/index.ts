import { Container } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
  ENCODING_CONTAINER: DurableObjectNamespace<EncodingContainer>;
}

export class EncodingContainer extends Container<Env> {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "10m";
  // Environment variables passed to the container
  envVars = {
    NODE_ENV: "production",
  };

  // Optional lifecycle hooks
  onStart() {
    console.log("Encoding container successfully started");
  }

  onStop() {
    console.log("Encoding container successfully shut down");
  }

  onError(error: unknown) {
    console.log("Encoding container error:", error);
  }
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Home route with available endpoints
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "encoding-service",
    endpoints: [
      "GET / - Health check and available endpoints",
      "POST /test - Test encoding with sample audio",
      "POST /encode - Encode provided audio URL",
      "POST /batch - Batch encode multiple files",
    ],
    timestamp: new Date().toISOString(),
  });
});

// Route requests to a specific container using the container ID
app.post("/test", async (c) => {
  const sessionId = "test-session";
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

app.post("/encode", async (c) => {
  const sessionId = `encode-${Date.now()}`;
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

app.post("/batch", async (c) => {
  const sessionId = `batch-${Date.now()}`;
  const containerId = c.env.ENCODING_CONTAINER.idFromName(sessionId);
  const container = c.env.ENCODING_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

// Default route for unknown endpoints
app.all("*", (c) => {
  return c.json(
    {
      error: "Endpoint not found",
      availableEndpoints: [
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
