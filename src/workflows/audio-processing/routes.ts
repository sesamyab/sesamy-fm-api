import { Hono } from "hono";
import type { Env } from "./types";

// Import implemented step classes
import { InitializeWorkflowStep } from "./initialize-workflow";
import { EncodeForProcessingStep } from "./encode-for-processing";
import { PrepareChunkStorageStep } from "./prepare-chunk-storage";

// Import placeholder step classes
import {
  AudioChunkingStep,
  TranscribeChunksStep,
  AudioEncodingStep,
  UpdateEpisodeEncodingsStep,
  CleanupResourcesStep,
  FinalizeProcessingStep,
} from "./step-classes";

const app = new Hono<{ Bindings: Env }>();

// Debug endpoint for initialize workflow step
app.post("/wf-debug/audio-processing/initialize", async (c) => {
  try {
    const input = await c.req.json();
    const step = new InitializeWorkflowStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for encode for processing step
app.post("/wf-debug/audio-processing/encode", async (c) => {
  try {
    const input = await c.req.json();
    const step = new EncodeForProcessingStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for prepare chunk storage step
app.post("/wf-debug/audio-processing/prepare-chunks", async (c) => {
  try {
    const input = await c.req.json();
    const step = new PrepareChunkStorageStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for audio chunking step
app.post("/wf-debug/audio-processing/chunk", async (c) => {
  try {
    const input = await c.req.json();
    const step = new AudioChunkingStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for transcribe chunks step
app.post("/wf-debug/audio-processing/transcribe", async (c) => {
  try {
    const input = await c.req.json();
    const step = new TranscribeChunksStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for audio encoding step
app.post("/wf-debug/audio-processing/encode-final", async (c) => {
  try {
    const input = await c.req.json();
    const step = new AudioEncodingStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for update episode encodings step
app.post("/wf-debug/audio-processing/update-episode", async (c) => {
  try {
    const input = await c.req.json();
    const step = new UpdateEpisodeEncodingsStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for cleanup resources step
app.post("/wf-debug/audio-processing/cleanup", async (c) => {
  try {
    const input = await c.req.json();
    const step = new CleanupResourcesStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Debug endpoint for finalize processing step
app.post("/wf-debug/audio-processing/finalize", async (c) => {
  try {
    const input = await c.req.json();
    const step = new FinalizeProcessingStep(c.env);
    const result = await step.execute(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400
    );
  }
});

// Health check endpoint for debug routes
app.get("/wf-debug/audio-processing/health", async (c) => {
  return c.json({
    success: true,
    message: "Audio processing debug routes are available",
    endpoints: [
      "POST /wf-debug/audio-processing/initialize",
      "POST /wf-debug/audio-processing/encode",
      "POST /wf-debug/audio-processing/prepare-chunks",
      "POST /wf-debug/audio-processing/chunk",
      "POST /wf-debug/audio-processing/transcribe",
      "POST /wf-debug/audio-processing/encode-final",
      "POST /wf-debug/audio-processing/update-episode",
      "POST /wf-debug/audio-processing/cleanup",
      "POST /wf-debug/audio-processing/finalize",
    ],
  });
});

export default app;
