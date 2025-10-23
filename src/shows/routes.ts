import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { ShowSchema, PaginationSchema, ShowParamsSchema } from "./schemas";
import type { AppContext } from "../auth/types";
import { getOrgId } from "../auth/helpers";
import { ShowService } from "./service";
import { AudioService } from "../audio/service";
import { ImageService } from "../images/service";

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

export function createShowRoutes(
  showService: ShowService,
  audioService?: AudioService,
  imageService?: ImageService,
  database?: D1Database,
  importShowWorkflow?: Workflow
) {
  const app = new OpenAPIHono<AppContext>();

  // --------------------------------
  // GET /shows
  // --------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/shows",
      tags: ["shows"],
      summary: "Get all shows",
      description: "Get a paginated list of podcast shows",
      security: [{ Bearer: ["podcast:read"] }],
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
    }),
    async (ctx) => {
      // Extract organization ID from context variables (set by auth middleware)
      const organizationId = getOrgId(ctx);

      const pagination = ctx.req.valid("query");
      const shows = await showService.getAllShows(pagination, organizationId);

      // Sign imageUrl in shows if they have r2:// URLs
      const signedShows = await Promise.all(
        shows.map((show) => signImageUrlInShow(show, audioService))
      );

      return ctx.json(signedShows);
    }
  );

  // --------------------------------
  // GET /shows/{show_id}
  // --------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/shows/{show_id}",
      tags: ["shows"],
      summary: "Get show by ID",
      description: "Get a specific podcast show by its ID",
      security: [{ Bearer: ["podcast:read"] }],
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
    }),
    async (ctx) => {
      const orgId = getOrgId(ctx);
      const { show_id } = ctx.req.valid("param");

      const show = await showService.getShowById(show_id, orgId);
      if (!show) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Show not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Sign imageUrl if it's an r2:// URL
      const signedShow = await signImageUrlInShow(show, audioService);

      return ctx.json(signedShow);
    }
  );

  // --------------------------------
  // PUT /shows/{show_id}/image
  // --------------------------------
  app.openapi(
    createRoute({
      method: "put",
      path: "/shows/{show_id}/image",
      tags: ["shows"],
      summary: "Upload show image",
      description: "Upload or update the cover image for a podcast show",
      security: [{ Bearer: ["podcast:write"] }],
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
          description: "Image uploaded successfully",
        },
        400: {
          description: "Invalid image file",
        },
        404: {
          description: "Show not found",
        },
        500: {
          description: "Internal server error",
        },
      },
    }),
    async (ctx) => {
      const orgId = getOrgId(ctx);

      if (!imageService) {
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Image service not available",
          instance: ctx.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }

      const { show_id } = ctx.req.valid("param");

      try {
        // First verify that the show exists and belongs to the user's organization
        const show = await showService.getShowById(show_id, orgId);
        if (!show) {
          const problem = {
            type: "not_found",
            title: "Not Found",
            status: 404,
            detail: "Show not found",
            instance: ctx.req.path,
          };
          throw new HTTPException(404, { message: JSON.stringify(problem) });
        }

        const formData = await ctx.req.formData();
        const imageFile = formData.get("image") as File | null;

        if (!imageFile) {
          const problem = {
            type: "validation_error",
            title: "Bad Request",
            status: 400,
            detail: "Image file is required",
            instance: ctx.req.path,
          };
          throw new HTTPException(400, { message: JSON.stringify(problem) });
        }

        const imageUpload = await imageService.uploadShowImage(
          show_id,
          imageFile
        );
        return ctx.json(imageUpload);
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
            instance: ctx.req.path,
          };
          throw new HTTPException(404, { message: JSON.stringify(problem) });
        }

        if (error.message?.includes("File must be an image")) {
          const problem = {
            type: "validation_error",
            title: "Bad Request",
            status: 400,
            detail: "File must be an image",
            instance: ctx.req.path,
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
            instance: ctx.req.path,
          };
          throw new HTTPException(500, { message: JSON.stringify(problem) });
        }

        if (error.message?.includes("Database error")) {
          const problem = {
            type: "internal_error",
            title: "Internal Server Error",
            status: 500,
            detail: "Database error occurred",
            instance: ctx.req.path,
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
          instance: ctx.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }
    }
  );

  return app;
}
