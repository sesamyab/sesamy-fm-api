import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { TaskService } from "./service.js";
import { requireScopes } from "../auth/middleware.js";
import { NotFoundError } from "../common/errors.js";

// Task status enum
const TaskStatusSchema = z.enum(["pending", "processing", "done", "failed"]);

// Task type enum
const TaskTypeSchema = z.enum([
  "transcribe",
  "encode",
  "audio_preprocess",
  "publish",
  "notification",
]);

// Base task schema
const TaskSchema = z.object({
  id: z.number(),
  type: TaskTypeSchema,
  status: TaskStatusSchema,
  payload: z.any().optional().nullable(),
  result: z.any().optional().nullable(),
  error: z.string().optional().nullable(),
  attempts: z.number(),
  started_at: z.string().optional().nullable(),
  progress: z.number().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Create task request schema
const CreateTaskSchema = z.object({
  type: TaskTypeSchema,
  payload: z.any().optional(),
});

// Query parameters for listing tasks
const TaskQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  offset: z.coerce.number().min(0).optional().default(0),
  sortBy: z
    .enum(["created_at", "updated_at", "type", "status"])
    .optional()
    .default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

// Task ID parameter schema
const TaskParamsSchema = z.object({
  task_id: z.coerce.number(),
});

// Test encoding request schema
const TestEncodeSchema = z.object({
  audioUrl: z.string().url().optional(),
  outputFormat: z.enum(["mp3", "aac"]).optional().default("mp3"),
  bitrate: z.coerce.number().min(64).max(320).optional().default(128),
});

// Test audio preprocessing request schema
const TestAudioPreprocessSchema = z.object({
  audioUrl: z.string().url().optional(),
  episodeId: z.string().optional(),
});

// Test transcription request schema
const TestTranscribeSchema = z.object({
  audioUrl: z.string().url().optional(),
  episodeId: z.string().optional(),
  chunked: z.boolean().optional().default(false),
  chunks: z
    .array(
      z.object({
        index: z.number(),
        url: z.string().url(),
        key: z.string(),
        startTime: z.number(),
        endTime: z.number(),
        duration: z.number(),
        size: z.number(),
        metadata: z.any().optional(),
      })
    )
    .optional(),
  overlapDuration: z.number().min(0).max(10).optional().default(2),
});

// Create task route
const createTaskRoute = createRoute({
  method: "post",
  path: "/tasks",
  tags: ["tasks"],
  summary: "Create a new task",
  description: "Create a new background processing task",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateTaskSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Task created successfully",
      content: {
        "application/json": {
          schema: TaskSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
    },
    401: {
      description: "Unauthorized",
    },
  },
});

// Get tasks route
const getTasksRoute = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["tasks"],
  summary: "List tasks",
  description:
    "Get a list of tasks with optional status filtering and sorting. Default sort is by created_at in descending order (newest first).",
  security: [{ Bearer: [] }],
  request: {
    query: TaskQuerySchema,
  },
  responses: {
    200: {
      description: "List of tasks",
      content: {
        "application/json": {
          schema: z.array(TaskSchema),
        },
      },
    },
    401: {
      description: "Unauthorized",
    },
  },
});

// Get specific task route
const getTaskRoute = createRoute({
  method: "get",
  path: "/tasks/{task_id}",
  tags: ["tasks"],
  summary: "Get a specific task",
  description: "Get details of a specific task by ID",
  security: [{ Bearer: [] }],
  request: {
    params: TaskParamsSchema,
  },
  responses: {
    200: {
      description: "Task details",
      content: {
        "application/json": {
          schema: TaskSchema,
        },
      },
    },
    404: {
      description: "Task not found",
    },
    401: {
      description: "Unauthorized",
    },
  },
});

// Retry task route
const retryTaskRoute = createRoute({
  method: "post",
  path: "/tasks/{task_id}/retry",
  tags: ["tasks"],
  summary: "Retry a failed task",
  description: "Reset a failed task to pending status and queue it for retry",
  security: [{ Bearer: [] }],
  request: {
    params: TaskParamsSchema,
  },
  responses: {
    200: {
      description: "Task retried successfully",
      content: {
        "application/json": {
          schema: TaskSchema,
        },
      },
    },
    404: {
      description: "Task not found",
    },
    401: {
      description: "Unauthorized",
    },
    400: {
      description: "Task cannot be retried",
    },
  },
});

// Test encoding route
const testEncodeRoute = createRoute({
  method: "post",
  path: "/tasks/test-encode",
  tags: ["tasks"],
  summary: "Test audio encoding",
  description:
    "Create a test encoding task with a predefined audio file to validate FFmpeg functionality (no authentication required)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: TestEncodeSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Test encoding task created successfully",
      content: {
        "application/json": {
          schema: z.object({
            task: TaskSchema,
            testInfo: z.object({
              audioUrl: z.string(),
              outputFormat: z.string(),
              bitrate: z.number(),
              estimatedSize: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

// Test audio preprocessing route
const testAudioPreprocessRoute = createRoute({
  method: "post",
  path: "/tasks/test-audio-preprocess",
  tags: ["tasks"],
  summary: "Test audio preprocessing with chunking",
  description:
    "Create a test audio preprocessing task that splits audio into chunks for transcription (no authentication required)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: TestAudioPreprocessSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Test audio preprocessing completed successfully",
      content: {
        "application/json": {
          schema: z.object({
            chunks: z.array(
              z.object({
                index: z.number(),
                url: z.string(),
                key: z.string(),
                startTime: z.number(),
                endTime: z.number(),
                duration: z.number(),
                size: z.number(),
              })
            ),
            totalChunks: z.number(),
            totalDuration: z.number(),
            processingMode: z.string(),
            testMode: z.boolean(),
            processingTime: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

// Test transcription route
const testTranscribeRoute = createRoute({
  method: "post",
  path: "/tasks/test-transcribe",
  tags: ["tasks"],
  summary: "Test audio transcription",
  description:
    "Create a test transcription task for single files or chunked audio (no authentication required)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: TestTranscribeSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Test transcription completed successfully",
      content: {
        "application/json": {
          schema: z.object({
            transcriptUrl: z.string(),
            transcriptKey: z.string(),
            textLength: z.number(),
            completedAt: z.string(),
            processingMode: z.string(),
            testMode: z.boolean().optional(),
            chunkDetails: z
              .object({
                totalChunks: z.number(),
                overlapDuration: z.number(),
                originalTextLength: z.number(),
                compressionRatio: z.string(),
              })
              .optional(),
            chunks: z
              .array(
                z.object({
                  index: z.number(),
                  startTime: z.number(),
                  endTime: z.number(),
                  wordCount: z.number(),
                  textLength: z.number(),
                })
              )
              .optional(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

export const createTaskRoutes = (
  database?: D1Database,
  bucket?: R2Bucket,
  ai?: Ai,
  queue?: Queue,
  encodingContainer?: DurableObjectNamespace,
  r2AccessKeyId?: string,
  r2SecretAccessKey?: string,
  r2Endpoint?: string
) => {
  const app = new OpenAPIHono();
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

  // Helper function to serialize task data for API response
  const serializeTask = (task: any) => ({
    ...task,
    payload: task.payload ? JSON.parse(task.payload) : null,
    result: task.result ? JSON.parse(task.result) : null,
  });

  // Apply authentication middleware - using colon notation to match user permissions
  app.use("*", requireScopes(["podcast:read", "podcast:write"]));

  // Test encode route (no authentication required) - add before auth middleware
  const testApp = new OpenAPIHono();
  testApp.openapi(testEncodeRoute, async (c) => {
    const body = c.req.valid("json");

    try {
      // Use default test audio URL if none provided
      const audioUrl =
        body.audioUrl ||
        "https://www.soundjay.com/misc/sounds/fail-buzzer-02.mp3";
      const payload = {
        audioUrl,
        outputFormat: body.outputFormat,
        bitrate: body.bitrate,
        episodeId: `test-encode-${Date.now()}`, // Generate test episode ID
      };

      const result = await taskService.testEncode(payload);

      // Create a mock task object for response
      const mockTask = {
        id: Date.now(),
        type: "encode" as const,
        status: "done" as const,
        payload,
        result,
        error: null,
        attempts: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return c.json(
        {
          task: mockTask,
          testInfo: {
            audioUrl,
            outputFormat: body.outputFormat,
            bitrate: body.bitrate,
            estimatedSize: "~1KB (mock)",
          },
        },
        201
      );
    } catch (error) {
      console.error("Test encoding failed:", error);
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Test encoding failed",
      });
    }
  });

  // Test audio preprocessing route handler
  testApp.openapi(testAudioPreprocessRoute, async (c) => {
    const body = c.req.valid("json");

    try {
      // Use default test audio URL if none provided
      const audioUrl =
        body.audioUrl ||
        "https://www.soundjay.com/misc/sounds/fail-buzzer-02.mp3";
      const payload = {
        audioUrl,
        episodeId: body.episodeId || `test-preprocess-${Date.now()}`,
      };

      const result = await taskService.testAudioPreprocess(payload);

      return c.json(result, 201);
    } catch (error) {
      console.error("Test audio preprocessing failed:", error);
      throw new HTTPException(400, {
        message:
          error instanceof Error
            ? error.message
            : "Test audio preprocessing failed",
      });
    }
  });

  // Test transcription route handler
  testApp.openapi(testTranscribeRoute, async (c) => {
    const body = c.req.valid("json");

    try {
      let payload;

      if (body.chunked && body.chunks) {
        // Chunked transcription
        payload = {
          episodeId: body.episodeId || `test-transcribe-chunked-${Date.now()}`,
          chunked: true,
          chunks: body.chunks,
          overlapDuration: body.overlapDuration,
        };
      } else {
        // Single file transcription
        const audioUrl =
          body.audioUrl ||
          "https://www.soundjay.com/misc/sounds/fail-buzzer-02.mp3";
        payload = {
          audioUrl,
          episodeId: body.episodeId || `test-transcribe-${Date.now()}`,
        };
      }

      const result = await taskService.testTranscribe(payload);

      return c.json(result, 201);
    } catch (error) {
      console.error("Test transcription failed:", error);
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Test transcription failed",
      });
    }
  });

  // Mount test routes without authentication
  app.route("/", testApp);

  // Create task
  app.openapi(createTaskRoute, async (c) => {
    const body = c.req.valid("json");

    const task = await taskService.createTask(body.type, body.payload);
    return c.json(serializeTask(task), 201);
  });

  // List tasks
  app.openapi(getTasksRoute, async (c) => {
    const query = c.req.valid("query");

    const tasks = await taskService.getTasks(
      query.status,
      query.limit,
      query.offset,
      query.sortBy,
      query.sortOrder
    );

    return c.json(tasks.map(serializeTask));
  });

  // Get specific task
  app.openapi(getTaskRoute, async (c) => {
    const { task_id } = c.req.valid("param");

    const task = await taskService.getTask(task_id);

    if (!task) {
      throw new NotFoundError(`Task with ID ${task_id} not found`);
    }

    return c.json(serializeTask(task));
  });

  // Retry task
  app.openapi(retryTaskRoute, async (c) => {
    const { task_id } = c.req.valid("param");

    try {
      const task = await taskService.retryTask(task_id);
      return c.json(serializeTask(task));
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Task not found") {
          throw new NotFoundError(`Task with ID ${task_id} not found`);
        }
        throw new HTTPException(400, { message: error.message });
      }
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  return app;
};
