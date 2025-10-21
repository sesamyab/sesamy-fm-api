import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { TaskService } from "./service.js";
import { NotFoundError } from "../common/errors.js";
import type { AppContext } from "../auth/types";
import { getOrgId } from "../auth/helpers";

// Task status enum
const TaskStatusSchema = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "canceled",
]);

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
  status: z
    .string()
    .optional()
    .describe(
      "Comma-separated list of statuses to filter by (e.g., 'pending,processing')"
    ),
  episodeId: z.string().optional().describe("Filter tasks by episode ID"),
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

export const createTaskRoutes = (database?: D1Database) => {
  const app = new OpenAPIHono<AppContext>();
  const taskService = new TaskService(database);

  // Helper function to serialize task data for API response
  const serializeTask = (task: any) => ({
    ...task,
    payload: task.payload ? JSON.parse(task.payload) : null,
    result: task.result ? JSON.parse(task.result) : null,
  });

  // --------------------------------
  // POST /tasks
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/tasks",
      tags: ["tasks"],
      summary: "Create a new task",
      description: "Create a new background processing task",
      security: [{ Bearer: ["tasks:write"] }],
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
    }),
    async (ctx) => {
      const body = ctx.req.valid("json");
      const organizationId = getOrgId(ctx);

      const task = await taskService.createTask(
        body.type,
        body.payload,
        organizationId
      );
      return ctx.json(serializeTask(task), 201);
    }
  );

  // --------------------------------
  // GET /tasks
  // --------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/tasks",
      tags: ["tasks"],
      summary: "List tasks",
      description:
        "Get a list of tasks with optional filtering by status (comma-separated: 'pending,processing'), episodeId, and sorting. Default sort is by created_at in descending order (newest first).",
      security: [{ Bearer: ["podcast:read"] }],
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
    }),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const organizationId = getOrgId(ctx);

      // Parse status filter (comma-separated values)
      const statusFilter = query.status
        ? query.status.split(",").map((s) => s.trim())
        : undefined;

      let tasks = await taskService.getTasks(
        undefined, // We'll filter status manually to support multiple values
        query.limit,
        query.offset,
        query.sortBy,
        query.sortOrder,
        organizationId
      );

      // Apply status filter (supports multiple statuses)
      if (statusFilter && statusFilter.length > 0) {
        tasks = tasks.filter((task) => statusFilter.includes(task.status));
      }

      // Apply episodeId filter
      if (query.episodeId) {
        tasks = tasks.filter((task) => {
          if (!task.payload) return false;
          try {
            const payload =
              typeof task.payload === "string"
                ? JSON.parse(task.payload)
                : task.payload;
            return payload.episodeId === query.episodeId;
          } catch {
            return false;
          }
        });
      }

      return ctx.json(tasks.map(serializeTask));
    }
  );

  // --------------------------------
  // GET /tasks/{task_id}
  // --------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/tasks/{task_id}",
      tags: ["tasks"],
      summary: "Get a specific task",
      description: "Get details of a specific task by ID",
      security: [{ Bearer: ["podcast:read"] }],
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
    }),
    async (ctx) => {
      const { task_id } = ctx.req.valid("param");
      const organizationId = getOrgId(ctx);

      const task = await taskService.getTask(task_id, organizationId);

      if (!task) {
        throw new NotFoundError(`Task with ID ${task_id} not found`);
      }

      return ctx.json(serializeTask(task));
    }
  );

  // --------------------------------
  // POST /tasks/{task_id}/retry
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/tasks/{task_id}/retry",
      tags: ["tasks"],
      summary: "Retry a failed task",
      description:
        "Reset a failed task to pending status and queue it for retry",
      security: [{ Bearer: ["podcast:write"] }],
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
    }),
    async (ctx) => {
      const { task_id } = ctx.req.valid("param");
      const organizationId = getOrgId(ctx);

      try {
        const task = await taskService.retryTask(task_id, organizationId);
        return ctx.json(serializeTask(task));
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Task not found") {
            throw new NotFoundError(`Task with ID ${task_id} not found`);
          }
          throw new HTTPException(400, { message: error.message });
        }
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // POST /tasks/{task_id}/cancel
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/tasks/{task_id}/cancel",
      tags: ["tasks"],
      summary: "Cancel a task",
      description:
        "Cancel a running or pending task. If the task has an associated workflow, it will be terminated. Tasks that are already done or canceled cannot be canceled.",
      security: [{ Bearer: ["podcast:write"] }],
      request: {
        params: TaskParamsSchema,
      },
      responses: {
        200: {
          description: "Task canceled successfully",
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
          description: "Task cannot be canceled",
        },
      },
    }),
    async (ctx) => {
      const { task_id } = ctx.req.valid("param");
      const organizationId = getOrgId(ctx);

      try {
        const task = await taskService.cancelTask(task_id, organizationId);
        return ctx.json(serializeTask(task));
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Task not found") {
            throw new NotFoundError(`Task with ID ${task_id} not found`);
          }
          throw new HTTPException(400, { message: error.message });
        }
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  return app;
};
