import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "../auth/types";
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
  app: OpenAPIHono<AppContext>,
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
      security: [
        {
          Bearer: [],
        },
      ],
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
    async (ctx) => {
      const { user } = ctx.var;

      console.log("Fetching organizations for user:", user);

      const organizations = await organizationService.getUserOrganizations(
        ctx.var.user.sub
      );
      return ctx.json(organizations, 200);
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
      security: [],
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
    async (ctx) => {
      const orgData = ctx.req.valid("json");

      const result = await organizationService.createOrganization(
        orgData.name,
        ctx.var.user.sub,
        orgData.display_name
      );

      return ctx.json(
        {
          id: result.organization.id,
          name: result.organization.name,
          created_at: result.organization.createdAt,
        },
        201
      );
    }
  );
}
