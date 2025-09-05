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
});

// Task ID parameter schema
const TaskParamsSchema = z.object({
  task_id: z.coerce.number(),
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
  description: "Get a list of tasks with optional status filtering",
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

export const createTaskRoutes = (database?: D1Database) => {
  const app = new OpenAPIHono();
  const taskService = new TaskService(database);

  // Helper function to serialize task data for API response
  const serializeTask = (task: any) => ({
    ...task,
    payload: task.payload ? JSON.parse(task.payload) : null,
    result: task.result ? JSON.parse(task.result) : null,
  });

  // Apply authentication middleware
  app.use("*", requireScopes(["podcast.read", "podcast.write"]));

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
      query.offset
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

  return app;
};
