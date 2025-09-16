import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { authMiddleware } from "../auth/middleware";

// Cloudflare Workers types (for environments where they're not globally available)
declare global {
  interface Workflow {
    create(options: { id: string; params: any }): Promise<{ id: string }>;
  }
}

// Workflow schemas
const WorkflowStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "terminated",
]);

const WorkflowTypeSchema = z.enum([
  "transcription",
  "audio-processing",
  "encoding",
  "custom",
]);

const workflowInstanceSchema = z.object({
  id: z.string(),
  workflowName: z.string(),
  status: WorkflowStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  episodeId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  error: z.string().optional(),
  progress: z.record(z.any()).optional(),
  estimatedProgress: z.number().min(0).max(100).optional(),
  estimatedDuration: z.string().optional(),
  actualDuration: z.number().optional(),
});

const WorkflowQuerySchema = z.object({
  status: WorkflowStatusSchema.optional(),
  workflowType: WorkflowTypeSchema.optional(),
  episodeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(["createdAt", "updatedAt", "status"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const WorkflowSearchSchema = z.object({
  episodeId: z.string().optional(),
  status: WorkflowStatusSchema.optional(),
  workflowType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// Workflow request schemas
const audioProcessingWorkflowSchema = z.object({
  episodeId: z.string().min(1),
  audioR2Key: z.string().min(1),
  chunkDuration: z.number().int().min(10).max(300).default(60),
  overlapDuration: z.number().int().min(0).max(10).default(2),
  encodingFormats: z.array(z.string()).default(["mp3_128"]),
  transcriptionLanguage: z.string().optional().default("en"), // Force language to avoid mixed language issues
});

// Helper function to fetch workflow instances from Cloudflare API
async function fetchWorkflowInstancesFromCloudflare(
  accountId: string,
  workflowName: string,
  apiToken: string
): Promise<any[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workflows/${workflowName}/instances`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `Cloudflare API error: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = (await response.json()) as {
      success: boolean;
      errors?: any[];
      result?: Array<{
        id: string;
        created_on: string;
        ended_on?: string;
        status: string;
        version_id: string;
      }>;
    };

    if (!data.success || !data.result) {
      console.error(`Cloudflare API error:`, data.errors);
      return [];
    }

    // Transform Cloudflare API response to match our schema
    return data.result.map((instance) => ({
      id: instance.id,
      workflowName: workflowName,
      status: mapCloudflareStatusToOurStatus(instance.status),
      createdAt: instance.created_on,
      updatedAt: instance.created_on, // Cloudflare doesn't provide updated_at
      completedAt: instance.ended_on,
      metadata: {
        version_id: instance.version_id,
        cloudflare_status: instance.status,
      },
    }));
  } catch (error) {
    console.error("Error fetching workflow instances from Cloudflare:", error);
    return [];
  }
}

// Map Cloudflare workflow status to our status enum
function mapCloudflareStatusToOurStatus(cloudflareStatus: string): string {
  const statusMap: Record<string, string> = {
    running: "running",
    complete: "completed",
    failed: "failed",
    paused: "paused",
    terminated: "terminated",
    queued: "queued",
  };

  return statusMap[cloudflareStatus] || "queued";
}

// Env type with workflow bindings
export interface Env {
  AUDIO_PROCESSING_WORKFLOW: Workflow;
  DB: D1Database;
  // Cloudflare API credentials for querying workflow instances
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

// Route definitions using createRoute
const healthRoute = createRoute({
  method: "get",
  path: "/workflows/health",
  tags: ["workflows"],
  summary: "Workflow system health check",
  description:
    "Check if the workflow system is operational and get available workflows",
  responses: {
    200: {
      description: "Workflow system status",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            status: z.string(),
            workflows: z.array(
              z.object({
                name: z.string(),
                type: z.string(),
                available: z.boolean(),
              })
            ),
            endpoints: z.array(z.string()),
            timestamp: z.string(),
          }),
        },
      },
    },
  },
  security: [{ Bearer: [] }],
});

const listInstancesRoute = createRoute({
  method: "get",
  path: "/workflows/instances",
  tags: ["workflows"],
  summary: "List workflow instances",
  description:
    "Get a paginated list of workflow instances with optional filtering",
  request: {
    query: WorkflowQuerySchema,
  },
  responses: {
    200: {
      description: "List of workflow instances",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            workflows: z.array(workflowInstanceSchema),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            }),
            filters: WorkflowQuerySchema.partial(),
          }),
        },
      },
    },
  },
  security: [{ Bearer: [] }],
});

const statsRoute = createRoute({
  method: "get",
  path: "/workflows/instances/stats",
  tags: ["workflows"],
  summary: "Get workflow statistics",
  description: "Get aggregated statistics about workflow instances",
  responses: {
    200: {
      description: "Workflow statistics",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            stats: z.object({
              total: z.number(),
              byStatus: z.record(z.string(), z.number()),
              byType: z.record(z.string(), z.number()),
              averageDuration: z.number().optional(),
              recentActivity: z.object({
                last24h: z.number(),
                last7d: z.number(),
                last30d: z.number(),
              }),
              successRate: z.number().min(0).max(100),
            }),
            generatedAt: z.string(),
          }),
        },
      },
    },
  },
  security: [{ Bearer: [] }],
});

const getInstanceRoute = createRoute({
  method: "get",
  path: "/workflows/instances/{workflowId}",
  tags: ["workflows"],
  summary: "Get workflow instance details",
  description: "Get detailed information about a specific workflow instance",
  request: {
    params: z.object({
      workflowId: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: "Workflow instance details",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            workflow: workflowInstanceSchema,
          }),
        },
      },
    },
    404: {
      description: "Workflow not found",
    },
  },
  security: [{ Bearer: [] }],
});

const audioProcessingRoute = createRoute({
  method: "post",
  path: "/workflows/audio-processing",
  tags: ["workflows"],
  summary: "Start audio processing workflow",
  description:
    "Starts a durable workflow that processes audio with encoding and transcription in parallel",
  request: {
    body: {
      content: {
        "application/json": {
          schema: audioProcessingWorkflowSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Workflow started successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            workflowId: z.string(),
            instanceId: z.string(),
            status: z.string(),
            episodeId: z.string(),
            estimatedDuration: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request body",
    },
  },
  security: [{ Bearer: [] }],
});

export function createWorkflowRoutes() {
  const app = new OpenAPIHono<{ Bindings: Env }>();

  // Apply auth middleware to all routes
  app.use("*", authMiddleware);

  // Health check endpoint
  app.openapi(healthRoute, async (c) => {
    const env = c.env;

    return c.json({
      success: true,
      status: "healthy",
      workflows: [
        {
          name: "audio-processing",
          type: "audio-processing",
          available: !!env.AUDIO_PROCESSING_WORKFLOW,
        },
      ],
      endpoints: [
        "GET /workflows/health",
        "GET /workflows/instances",
        "GET /workflows/instances/{workflowId}",
        "GET /workflows/instances/stats",
        "POST /workflows/transcription",
        "POST /workflows/audio-processing",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // List workflow instances
  app.openapi(listInstancesRoute, async (c) => {
    try {
      const query = c.req.valid("query");
      const env = c.env;

      let allWorkflows: any[] = [];

      // Try to fetch from Cloudflare API if credentials are available
      if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
        const cloudflareInstances = await fetchWorkflowInstancesFromCloudflare(
          env.CLOUDFLARE_ACCOUNT_ID,
          "audio-processing-workflow", // This should match your workflow name in Cloudflare
          env.CLOUDFLARE_API_TOKEN
        );
        allWorkflows = cloudflareInstances;
      } else {
        console.warn(
          "Cloudflare API credentials not configured, returning empty list"
        );
      }

      // Apply client-side filtering since Cloudflare API doesn't support all our filter options
      let filteredWorkflows = allWorkflows;

      if (query.status) {
        filteredWorkflows = filteredWorkflows.filter(
          (w) => w.status === query.status
        );
      }

      if (query.episodeId) {
        filteredWorkflows = filteredWorkflows.filter(
          (w) => w.metadata?.episodeId === query.episodeId
        );
      }

      // Sort workflows
      filteredWorkflows.sort((a, b) => {
        const aValue = a[query.sortBy] || "";
        const bValue = b[query.sortBy] || "";

        if (query.sortOrder === "desc") {
          return bValue.localeCompare(aValue);
        } else {
          return aValue.localeCompare(bValue);
        }
      });

      // Apply pagination
      const total = filteredWorkflows.length;
      const paginatedWorkflows = filteredWorkflows.slice(
        query.offset,
        query.offset + query.limit
      );

      return c.json({
        success: true,
        workflows: paginatedWorkflows,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: total > query.offset + query.limit,
        },
        filters: {
          status: query.status,
          workflowType: query.workflowType,
          episodeId: query.episodeId,
        },
      });
    } catch (error) {
      console.error("Failed to list workflow instances:", error);
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get workflow statistics
  app.openapi(statsRoute, async (c) => {
    try {
      // Placeholder implementation
      const stats = {
        total: 0,
        byStatus: {} as Record<string, number>,
        byType: {} as Record<string, number>,
        recentActivity: {
          last24h: 0,
          last7d: 0,
          last30d: 0,
        },
        successRate: 0,
        averageDuration: undefined as number | undefined,
      };

      return c.json({
        success: true,
        stats,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to get workflow stats:", error);
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get specific workflow instance
  app.openapi(getInstanceRoute, async (c) => {
    try {
      const { workflowId } = c.req.valid("param");

      // Placeholder implementation - would query actual workflow storage
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Workflow not found",
        instance: c.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("Failed to get workflow instance:", error);
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Start audio processing workflow
  app.openapi(audioProcessingRoute, async (c) => {
    try {
      const env = c.env;
      const body = c.req.valid("json");

      const instanceId = crypto.randomUUID();

      // Start the workflow
      const instance = await env.AUDIO_PROCESSING_WORKFLOW.create({
        id: instanceId,
        params: body,
      });

      return c.json(
        {
          success: true,
          message: "Audio processing workflow started successfully",
          workflowId: "audio-processing",
          instanceId: instance.id,
          status: "queued",
          episodeId: body.episodeId,
          estimatedDuration: "5-15 minutes",
        },
        202
      );
    } catch (error) {
      console.error("Failed to start audio processing workflow:", error);

      if (error instanceof HTTPException) {
        throw error;
      }

      // Check if it's a validation error
      if (error instanceof Error && error.message.includes("validation")) {
        const problem = {
          type: "bad_request",
          title: "Bad Request",
          status: 400,
          detail: error.message,
          instance: c.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return app;
}
