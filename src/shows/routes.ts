import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  CreateShowSchema,
  UpdateShowSchema,
  ShowSchema,
  PaginationSchema,
  ShowParamsSchema,
  ImageUploadSchema,
  ImportShowFromRSSSchema,
  ImportShowResponseSchema,
  RSSPreviewRequestSchema,
  RSSPreviewResponseSchema,
} from "./schemas";
import { ShowService } from "./service";
import { AudioService } from "../audio/service";
import { ImageService } from "../images/service";
import {
  requireScopes,
  hasPermissions,
  hasScopes,
  getOrganizationId,
} from "../auth/middleware";
import { NotFoundError } from "../common/errors";
import { JWTPayload } from "../auth/types";
import { TaskService } from "../tasks/service";
import {
  fetchAndParseRSS,
  RSSParseError,
  RSSValidationError,
} from "../workflows/import-show/rss-parser";

// Utility function to sign imageUrl in show data
async function signImageUrlInShow(show: any, audioService?: AudioService) {
  if (!show.imageUrl || !show.imageUrl.startsWith("r2://") || !audioService) {
    return show;
  }

  try {
    // Extract the R2 key from the r2:// URL
    const r2Key = show.imageUrl.replace("r2://", "");

    // Generate a fresh pre-signed URL
    const signedUrl = await audioService.generateSignedUrlFromKey(r2Key);

    if (signedUrl) {
      return {
        ...show,
        imageUrl: signedUrl,
      };
    }
  } catch (error) {
    console.warn("Failed to sign imageUrl for show:", show.id, error);
  }

  return show;
}

// Get shows route
const getShowsRoute = createRoute({
  method: "get",
  path: "/shows",
  tags: ["shows"],
  summary: "Get all shows",
  description: "Get a paginated list of podcast shows",
  request: {
    query: PaginationSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ShowSchema.array(),
        },
      },
      description: "List of shows",
    },
  },
  security: [{ Bearer: [] }],
});

// Get show by ID route
const getShowRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}",
  tags: ["shows"],
  summary: "Get show by ID",
  description: "Get a specific podcast show by its ID",
  request: {
    params: ShowParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ShowSchema,
        },
      },
      description: "Show details",
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Create show route
const createShowRoute = createRoute({
  method: "post",
  path: "/shows",
  tags: ["shows"],
  summary: "Create a new show",
  description: "Create a new podcast show",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateShowSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: ShowSchema,
        },
      },
      description: "Created show",
    },
  },
  security: [{ Bearer: [] }],
});

// Import show from RSS route
const importShowFromRSSRoute = createRoute({
  method: "post",
  path: "/shows/import",
  tags: ["shows"],
  summary: "Import show from RSS",
  description: "Import a podcast show and its episodes from an RSS feed URL",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ImportShowFromRSSSchema,
        },
      },
    },
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: ImportShowResponseSchema,
        },
      },
      description: "Import task created successfully",
    },
    400: {
      description: "Invalid RSS URL or parsing error",
    },
    500: {
      description: "Internal server error",
    },
  },
  security: [{ Bearer: [] }],
});

// RSS preview route
const rssPreviewRoute = createRoute({
  method: "post",
  path: "/shows/preview-rss",
  tags: ["shows"],
  summary: "Preview RSS feed",
  description:
    "Parse and preview an RSS feed without importing it. Returns the parsed show and episode data in JSON format with any validation errors.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RSSPreviewRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RSSPreviewResponseSchema,
        },
      },
      description:
        "RSS feed parsed successfully (may include validation errors)",
    },
    400: {
      description: "Invalid request or RSS URL format",
    },
    500: {
      description: "Internal server error",
    },
  },
  security: [{ Bearer: [] }],
});

// Update show route
const updateShowRoute = createRoute({
  method: "patch",
  path: "/shows/{show_id}",
  tags: ["shows"],
  summary: "Update a show",
  description: "Update an existing podcast show",
  request: {
    params: ShowParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateShowSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ShowSchema,
        },
      },
      description: "Updated show",
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Delete show route
const deleteShowRoute = createRoute({
  method: "delete",
  path: "/shows/{show_id}",
  tags: ["shows"],
  summary: "Delete a show",
  description: "Delete an existing podcast show",
  request: {
    params: ShowParamsSchema,
  },
  responses: {
    204: {
      description: "Show deleted successfully",
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Upload show image route
const uploadShowImageRoute = createRoute({
  method: "post",
  path: "/shows/{show_id}/image",
  tags: ["shows"],
  summary: "Upload show image",
  description: "Upload an image file for a show",
  request: {
    params: ShowParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            image: z.any().openapi({
              type: "string",
              format: "binary",
              description: "Image file to upload",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ImageUploadSchema,
        },
      },
      description: "Image uploaded successfully",
    },
    400: {
      description: "Invalid file or request",
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

export function registerShowRoutes(
  app: OpenAPIHono,
  showService: ShowService,
  audioService?: AudioService,
  imageService?: ImageService,
  database?: D1Database,
  importShowWorkflow?: Workflow
) {
  // Get all shows
  app.openapi(getShowsRoute, async (c) => {
    // Check auth - look for permissions first, then fall back to scopes
    const payload = c.get("jwtPayload") as JWTPayload;

    const hasReadPermission = hasPermissions(payload, ["podcast:read"]);
    const hasReadScope = hasScopes(payload, ["podcast.read"]);

    if (!hasReadPermission && !hasReadScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:read OR scopes: podcast.read",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const pagination = c.req.valid("query");
    const shows = await showService.getAllShows(pagination);

    // Sign imageUrl in shows if they have r2:// URLs
    const signedShows = await Promise.all(
      shows.map((show) => signImageUrlInShow(show, audioService))
    );

    return c.json(signedShows);
  });

  // Get show by ID
  app.openapi(getShowRoute, async (c) => {
    // Check auth - look for permissions first, then fall back to scopes
    const payload = c.get("jwtPayload") as JWTPayload;

    const hasReadPermission = hasPermissions(payload, ["podcast:read"]);
    const hasReadScope = hasScopes(payload, ["podcast.read"]);

    if (!hasReadPermission && !hasReadScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:read OR scopes: podcast.read",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const { show_id } = c.req.valid("param");
    const show = await showService.getShowById(show_id);

    if (!show) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Show not found",
        instance: c.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    // Sign imageUrl if it has r2:// URL
    const signedShow = await signImageUrlInShow(show, audioService);

    return c.json(signedShow);
  });

  // Create show
  app.openapi(createShowRoute, async (c) => {
    // Check auth
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasWritePermission = hasPermissions(payload, ["podcast:write"]);
    const hasWriteScope = hasScopes(payload, ["podcast.write"]);
    if (!hasWritePermission && !hasWriteScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:write or scope: podcast.write",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    // Get organization ID from JWT
    const organizationId = getOrganizationId(payload);
    if (!organizationId) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Organization context required. Please select an organization.",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const showData = c.req.valid("json");
    const show = await showService.createShow(showData, organizationId);

    // Sign imageUrl if it has r2:// URL
    const signedShow = await signImageUrlInShow(show, audioService);

    return c.json(signedShow, 201);
  });

  // Import show from RSS
  app.openapi(importShowFromRSSRoute, async (c) => {
    // Check auth
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasWritePermission = hasPermissions(payload, ["podcast:write"]);
    const hasWriteScope = hasScopes(payload, ["podcast.write"]);
    if (!hasWritePermission && !hasWriteScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:write or scope: podcast.write",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const importData = c.req.valid("json");

    try {
      // First validate the RSS feed by attempting to parse it
      console.log(`Validating RSS feed: ${importData.rssUrl}`);

      // Test fetch and parse the RSS to validate it immediately
      await fetchAndParseRSS(importData.rssUrl);

      // If validation succeeds, create the task and workflow
      if (!database) {
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Database not available",
          instance: c.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }

      if (!importShowWorkflow) {
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Import workflow not available",
          instance: c.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }

      const taskService = new TaskService(
        database,
        undefined,
        importShowWorkflow
      );

      // Create import task
      const task = await taskService.createTask("import_show" as any, {
        rssUrl: importData.rssUrl,
        maxEpisodes: importData.maxEpisodes || 100,
        skipExistingEpisodes: importData.skipExistingEpisodes || false,
      });

      console.log(
        `Created import task ${task.id} for RSS: ${importData.rssUrl}`
      );

      return c.json(
        {
          taskId: task.id.toString(),
          workflowId: task.workflowId || "pending",
          message: `RSS import task created successfully. Task ID: ${task.id}`,
        },
        202
      );
    } catch (error) {
      console.error("Import show from RSS failed:", error);

      if (error instanceof RSSParseError) {
        const problem = {
          type: "validation_error",
          title: "RSS Validation Error",
          status: 400,
          detail: `RSS parsing failed: ${error.message}`,
          instance: c.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      if (error instanceof RSSValidationError) {
        const problem = {
          type: "validation_error",
          title: "RSS Validation Error",
          status: 400,
          detail: `RSS validation failed: ${
            error.message
          }. Errors: ${error.validationErrors
            .map((e) => e.message)
            .join(", ")}`,
          instance: c.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      if (error instanceof HTTPException) {
        throw error;
      }

      const problem = {
        type: "internal_error",
        title: "Internal Server Error",
        status: 500,
        detail: `Failed to create import task: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        instance: c.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  // RSS preview
  app.openapi(rssPreviewRoute, async (c) => {
    // Check auth
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasReadPermission = hasPermissions(payload, ["podcast:read"]);
    const hasReadScope = hasScopes(payload, ["podcast.read"]);
    if (!hasReadPermission && !hasReadScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:read or scope: podcast.read",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const { rssUrl } = c.req.valid("json");

    try {
      console.log(`Previewing RSS feed: ${rssUrl}`);

      // Parse the RSS feed
      const parsedRSS = await fetchAndParseRSS(rssUrl);

      // Return successful response with parsed data
      return c.json({
        success: true,
        data: {
          title: parsedRSS.title,
          description: parsedRSS.description,
          imageUrl: parsedRSS.imageUrl || null,
          language: parsedRSS.language,
          categories: parsedRSS.categories,
          author: parsedRSS.author,
          totalEpisodes: parsedRSS.episodes.length,
          episodes: parsedRSS.episodes,
        },
      });
    } catch (error) {
      console.error("RSS preview failed:", error);

      // For RSS parsing errors, return a structured error response
      if (error instanceof RSSParseError) {
        return c.json({
          success: false,
          errors: [
            {
              type: "rss_parse_error",
              message: error.message,
              details: error.cause ? { cause: error.cause.message } : undefined,
            },
          ],
        });
      }

      if (error instanceof RSSValidationError) {
        return c.json({
          success: false,
          errors: [
            {
              type: "rss_validation_error",
              message: error.message,
              details: { validationErrors: error.validationErrors },
            },
          ],
        });
      }

      // For other errors, return a generic error response
      return c.json({
        success: false,
        errors: [
          {
            type: "unknown_error",
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
          },
        ],
      });
    }
  });

  // Update show
  app.openapi(updateShowRoute, async (c) => {
    // Check auth
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasWritePermission = hasPermissions(payload, ["podcast:write"]);
    const hasWriteScope = hasScopes(payload, ["podcast.write"]);
    if (!hasWritePermission && !hasWriteScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:write or scope: podcast.write",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const { show_id } = c.req.valid("param");
    const updateData = c.req.valid("json");

    try {
      const show = await showService.updateShow(show_id, updateData);

      // Sign imageUrl if it has r2:// URL
      const signedShow = await signImageUrlInShow(show, audioService);

      return c.json(signedShow);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Show not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // Delete show
  app.openapi(deleteShowRoute, async (c) => {
    // Check auth
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasWritePermission = hasPermissions(payload, ["podcast:write"]);
    const hasWriteScope = hasScopes(payload, ["podcast.write"]);
    if (!hasWritePermission && !hasWriteScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:write or scope: podcast.write",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const { show_id } = c.req.valid("param");

    try {
      await showService.deleteShow(show_id);
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Show not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // Upload show image
  app.openapi(uploadShowImageRoute, async (c) => {
    // Check authorization
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasWritePermission = hasPermissions(payload, ["podcast:write"]);
    const hasWriteScope = hasScopes(payload, ["podcast.write"]);
    if (!hasWritePermission && !hasWriteScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Required permissions: podcast:write or scope: podcast.write",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    if (!imageService) {
      const problem = {
        type: "internal_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Image service not available",
        instance: c.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }

    const { show_id } = c.req.valid("param");

    try {
      const formData = await c.req.formData();
      const imageFile = formData.get("image") as File | null;

      if (!imageFile) {
        const problem = {
          type: "validation_error",
          title: "Bad Request",
          status: 400,
          detail: "Image file is required",
          instance: c.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      const imageUpload = await imageService.uploadShowImage(
        show_id,
        imageFile
      );
      return c.json(imageUpload);
    } catch (error: any) {
      console.error("[ShowRoutes] Image upload error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
        cause: error.cause,
        errorString: String(error),
        errorType: typeof error,
      });

      if (error.message?.includes("not found")) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Show not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      if (error.message?.includes("File must be an image")) {
        const problem = {
          type: "validation_error",
          title: "Bad Request",
          status: 400,
          detail: "File must be an image",
          instance: c.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      if (
        error.message?.includes("R2 bucket") ||
        error.message?.includes("storage service")
      ) {
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Image storage service is temporarily unavailable",
          instance: c.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }

      if (error.message?.includes("Database error")) {
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Database error occurred",
          instance: c.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }

      // For any other unexpected errors, log details and return generic error with more context
      const problem = {
        type: "internal_error",
        title: "Internal Server Error",
        status: 500,
        detail: `An unexpected error occurred while uploading the image: ${
          error.message || "Unknown error"
        }`,
        instance: c.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });
}
