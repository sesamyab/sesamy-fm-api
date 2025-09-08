import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskService } from "../tasks/service";

export function createTranscriptionRoutes(
  database?: D1Database,
  bucket?: R2Bucket,
  ai?: Ai,
  queue?: Queue,
  encodingContainer?: DurableObjectNamespace,
  r2AccessKeyId?: string,
  r2SecretAccessKey?: string,
  r2Endpoint?: string
) {
  const app = new OpenAPIHono();

  // Skip if no AI binding is available
  if (!ai || !bucket) {
    app.get("/transcription", (c) => {
      return c.json(
        {
          status: "unavailable",
          service: "transcription-service",
          message: "AI or R2 bucket binding not configured",
        },
        503
      );
    });
    return app;
  }

  // Transcription service health check
  app.get("/transcription", (c) => {
    return c.json({
      status: "ok",
      service: "transcription-service",
      endpoints: [
        "GET /transcription - Health check and available endpoints",
        "POST /transcription/test - Test transcription with sample audio (no auth required)",
        "POST /transcription/transcribe - Transcribe provided audio URL",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // Test transcription endpoint (no auth required)
  app.post("/transcription/test", async (c) => {
    if (!bucket || !ai) {
      return c.json(
        {
          success: false,
          error: "AI and R2 bucket bindings are required for transcription",
        },
        503
      );
    }

    const body = await c.req.json().catch(() => ({}));

    // Use provided URL or default test audio (shorter audio file for faster transcription)
    const defaultTestAudio =
      "https://podcast-media.sesamy.dev/audio/b0253f27-f247-46be-a9df-df7fbc1bc437/0a215bd9-65a5-4e71-9566-860ea84da493/2b6418e9-ea7c-42b1-ab63-0ac70d662e71/8f7cd1ff-dfcd-4184-bff1-bcf776c80b92.mp3";
    const audioUrl = body.audioUrl || defaultTestAudio;

    // Generate a test episode ID for the transcription
    const testEpisodeId = `test-transcribe-${Date.now()}`;

    try {
      // Perform transcription directly using the testTranscribe method
      const taskService = new TaskService(
        database,
        bucket,
        ai,
        queue,
        encodingContainer,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
      const result = await taskService.testTranscribe({
        episodeId: testEpisodeId,
        audioUrl: audioUrl,
      });

      // Return the transcription result
      return c.json(
        {
          success: true,
          message: "Test transcription completed successfully",
          result: result,
          testInfo: {
            audioUrl: audioUrl,
            episodeId: testEpisodeId,
            model: "@cf/openai/whisper",
          },
        },
        200
      );
    } catch (error) {
      console.error("Test transcription failed:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          testInfo: {
            audioUrl,
            model: "@cf/openai/whisper",
          },
        },
        500
      );
    }
  });

  app.post("/transcription/transcribe", async (c) => {
    if (!bucket || !ai) {
      return c.json(
        {
          success: false,
          error: "AI and R2 bucket bindings are required for transcription",
        },
        503
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const { episodeId, audioUrl } = body;

    if (!episodeId || !audioUrl) {
      return c.json(
        {
          success: false,
          error: "Episode ID and audio URL are required",
        },
        400
      );
    }

    try {
      // Create a task for transcription (this will be processed in the background)
      const taskService = new TaskService(
        database,
        bucket,
        ai,
        queue,
        encodingContainer,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
      const task = await taskService.createTask("transcribe", {
        episodeId,
        audioUrl,
      });

      return c.json(
        {
          success: true,
          message: "Transcription task created successfully",
          taskId: task.id,
          episodeId,
          status: "queued",
        },
        202
      );
    } catch (error) {
      console.error("Failed to create transcription task:", error);
      return c.json(
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
