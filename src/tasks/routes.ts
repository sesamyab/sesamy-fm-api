import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { TaskService } from "./service.js";
import { requireScopes } from "../auth/middleware.js";
import { NotFoundError } from "../common/errors.js";

// Task status enum
const TaskStatusSchema = z.enum(["pending", "processing", "done", "failed"]);

// Task type enum
const TaskTypeSchema = z.enum(["audio_processing"]);

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

export const createTaskRoutes = (database?: D1Database) => {
  const app = new OpenAPIHono();
  const taskService = new TaskService(database);

  // Helper function to serialize task data for API response
  const serializeTask = (task: any) => ({
    ...task,
    payload: task.payload ? JSON.parse(task.payload) : null,
    result: task.result ? JSON.parse(task.result) : null,
  });

  // Apply authentication middleware - using colon notation to match user permissions
  app.use("*", requireScopes(["podcast:read", "podcast:write"]));

  // --------------------------------
  // POST /tasks
  // --------------------------------
  app.openapi(createTaskRoute, async (c) => {
    const body = c.req.valid("json");

    const task = await taskService.createTask(body.type, body.payload);
    return c.json(serializeTask(task), 201);
  });

  // --------------------------------
  // GET /tasks
  // --------------------------------
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

  // --------------------------------
  // GET /tasks/{task_id}
  // --------------------------------
  app.openapi(getTaskRoute, async (c) => {
    const { task_id } = c.req.valid("param");

    const task = await taskService.getTask(task_id);

    if (!task) {
      throw new NotFoundError(`Task with ID ${task_id} not found`);
    }

    return c.json(serializeTask(task));
  });

  // --------------------------------
  // POST /tasks/{task_id}/retry
  // --------------------------------
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
