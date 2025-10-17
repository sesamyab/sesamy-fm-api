import { OpenAPIHono } from "@hono/zod-openapi";
import { createEncodingService } from "./service";

export function createEncodingRoutes(
  encodingContainer?: DurableObjectNamespace,
  database?: D1Database,
  bucket?: R2Bucket,
  ai?: Ai,
  awsLambdaUrl?: string,
  awsApiKey?: string
) {
  const app = new OpenAPIHono();

  // Create encoding service instance
  let encodingService: ReturnType<typeof createEncodingService> | null = null;

  try {
    encodingService = createEncodingService(
      encodingContainer,
      awsLambdaUrl,
      awsApiKey
    );
  } catch (error) {
    console.error("Failed to create encoding service:", error);
  }

  // Skip if no encoding service is available
  if (!encodingService) {
    app.get("/encoding", (ctx) => {
      return ctx.json(
        {
          status: "unavailable",
          service: "encoding-service",
          message:
            "No encoding service configured (neither Cloudflare container nor AWS Lambda)",
        },
        503
      );
    });
    return app;
  }

  // Encoding service health check
  app.get("/encoding", (ctx) => {
    return ctx.json({
      status: "ok",
      service: "encoding-service",
      type: awsLambdaUrl ? "aws-lambda" : "cloudflare-container",
      endpoints: [
        "GET /encoding - Health check and available endpoints",
        "POST /encoding/encode - Encode provided audio URL",
        "POST /encoding/metadata - Get audio metadata",
        "POST /encoding/test - Test encoding functionality",
        "POST /encoding/warmup - Warmup the encoding service",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // Encode audio endpoint
  app.post("/encoding/encode", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const result = await encodingService.encode(body);
      return ctx.json(result);
    } catch (error) {
      return ctx.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
        500
      );
    }
  });

  // Get audio metadata endpoint
  app.post("/encoding/metadata", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const result = await encodingService.getMetadata(body);
      return ctx.json(result);
    } catch (error) {
      return ctx.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  // Test encoding endpoint
  app.post("/encoding/test", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const { outputFormat = "mp3", bitrate = 128 } = body;
      const result = await encodingService.testEncoding(outputFormat, bitrate);
      return ctx.json(result);
    } catch (error) {
      return ctx.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
        500
      );
    }
  });

  // Warmup endpoint
  app.post("/encoding/warmup", async (ctx) => {
    try {
      const result = await encodingService.warmup();
      return ctx.json(result);
    } catch (error) {
      return ctx.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  return app;
}
