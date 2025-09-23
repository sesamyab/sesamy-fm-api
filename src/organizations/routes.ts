import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { JWTPayload } from "../auth/types";
import { OrganizationService } from "./service";

// Schemas
const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  auth0_id: z.string(),
});

const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().max(100).optional(),
});

export function registerOrganizationRoutes(
  app: OpenAPIHono,
  organizationService: OrganizationService
) {
  // --------------------------------
  // GET /organizations
  // --------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations",
      tags: ["Organizations"],
      summary: "Get user's organizations",
      description:
        "Get all organizations that the authenticated user is a member of",
      responses: {
        200: {
          description: "User's organizations",
          content: {
            "application/json": {
              schema: z.array(OrganizationSchema),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      if (!payload.sub) {
        const problem = {
          type: "unauthorized",
          title: "Unauthorized",
          status: 401,
          detail: "Invalid user ID in token",
          instance: c.req.path,
        };
        throw new HTTPException(401, { message: JSON.stringify(problem) });
      }

      try {
        const organizations = await organizationService.getUserOrganizations(
          payload.sub
        );
        return c.json(organizations, 200);
      } catch (error) {
        console.error("Error getting user organizations:", error);
        const problem = {
          type: "internal_error",
          title: "Internal Server Error",
          status: 500,
          detail: "Failed to fetch organizations",
          instance: c.req.path,
        };
        throw new HTTPException(500, { message: JSON.stringify(problem) });
      }
    }
  );

  // --------------------------------
  // POST /organizations
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations",
      tags: ["Organizations"],
      summary: "Create a new organization",
      description: "Create a new organization and assign the user as admin",
      request: {
        body: {
          content: {
            "application/json": {
              schema: CreateOrganizationSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: "Organization created successfully",
          content: {
            "application/json": {
              schema: z.object({
                id: z.string(),
                name: z.string(),
                created_at: z.string(),
              }),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
        409: {
          description: "Conflict - Organization name already exists",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
        503: {
          description: "Service unavailable",
          content: {
            "application/json": {
              schema: z.object({
                type: z.string(),
                title: z.string(),
                status: z.number(),
                detail: z.string(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      if (!payload.sub) {
        const problem = {
          type: "unauthorized",
          title: "Unauthorized",
          status: 401,
          detail: "Invalid user ID in token",
          instance: c.req.path,
        };
        throw new HTTPException(401, { message: JSON.stringify(problem) });
      }

      const orgData = c.req.valid("json");

      try {
        const result = await organizationService.createOrganization(
          orgData.name,
          payload.sub,
          orgData.display_name
        );

        return c.json(
          {
            id: result.organization.id,
            name: result.organization.name,
            created_at: result.organization.createdAt,
          },
          201
        );
      } catch (error: any) {
        console.error("Error creating organization:", error);

        // Determine status and problem type based on error message
        const errorMessage = error.message || "";

        if (errorMessage.includes("already exists")) {
          const problem = {
            type: "conflict",
            title: "Conflict",
            status: 409,
            detail: error.message,
            instance: c.req.path,
          };
          throw new HTTPException(409, {
            message: JSON.stringify(problem),
          });
        } else if (errorMessage.includes("Invalid organization data")) {
          const problem = {
            type: "bad_request",
            title: "Bad Request",
            status: 400,
            detail: error.message,
            instance: c.req.path,
          };
          throw new HTTPException(400, {
            message: JSON.stringify(problem),
          });
        } else if (errorMessage.includes("Insufficient permissions")) {
          const problem = {
            type: "forbidden",
            title: "Forbidden",
            status: 403,
            detail: error.message,
            instance: c.req.path,
          };
          throw new HTTPException(403, {
            message: JSON.stringify(problem),
          });
        } else if (errorMessage.includes("Auth0 service not configured")) {
          const problem = {
            type: "service_unavailable",
            title: "Service Unavailable",
            status: 503,
            detail: "Organization service is not properly configured",
            instance: c.req.path,
          };
          throw new HTTPException(503, {
            message: JSON.stringify(problem),
          });
        } else {
          const problem = {
            type: "internal_error",
            title: "Internal Server Error",
            status: 500,
            detail: error.message || "Failed to create organization",
            instance: c.req.path,
          };
          throw new HTTPException(500, {
            message: JSON.stringify(problem),
          });
        }
      }
    }
  );
}
