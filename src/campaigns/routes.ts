import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  CampaignSchema,
  CampaignWithDetailsSchema,
  PaginationSchema,
  CampaignParamsSchema,
  CreativeParamsSchema,
  CreateCreativeSchema,
  UpdateCreativeSchema,
  CreativeSchema,
  CreativeUploadSchema,
} from "./schemas";
import { CampaignService } from "./service";
import { AudioService } from "../audio/service";
import { CreativeUploadService } from "./creative-upload-service";
import {
  requireScopes,
  hasPermissions,
  hasScopes,
  getOrganizationId,
} from "../auth/middleware";
import { NotFoundError } from "../common/errors";
import { JWTPayload } from "../auth/types";

// Utility function to sign URLs in creatives
async function signUrlsInCreative(creative: any, audioService?: AudioService) {
  const result = { ...creative };

  if (!audioService) {
    return result;
  }

  // Sign audio URL if present
  if (creative.audioUrl && creative.audioUrl.startsWith("r2://")) {
    try {
      const r2Key = creative.audioUrl.replace("r2://", "");
      const signedUrl = await audioService.generateSignedUrlFromKey(r2Key);
      if (signedUrl) {
        result.audioUrl = signedUrl;
      }
    } catch (error) {
      console.warn("Failed to sign audioUrl for creative:", creative.id, error);
    }
  }

  // Sign image URL if present
  if (creative.imageUrl && creative.imageUrl.startsWith("r2://")) {
    try {
      const r2Key = creative.imageUrl.replace("r2://", "");
      const signedUrl = await audioService.generateSignedUrlFromKey(r2Key);
      if (signedUrl) {
        result.imageUrl = signedUrl;
      }
    } catch (error) {
      console.warn("Failed to sign imageUrl for creative:", creative.id, error);
    }
  }

  return result;
}

export function createCampaignRoutes(
  campaignService: CampaignService,
  audioService?: AudioService,
  creativeUploadService?: CreativeUploadService
) {
  const app = new OpenAPIHono();

  // Apply authentication middleware
  app.use("*", requireScopes(["campaigns:read", "campaigns:write"]));

  // --------------------------------
  // GET /campaigns
  // --------------------------------
  app.openapi(
    {
      method: "get",
      path: "/campaigns",
      tags: ["campaigns"],
      summary: "Get campaigns",
      description: "Get all campaigns with pagination",
      request: {
        query: PaginationSchema,
      },
      responses: {
        200: {
          description: "Campaigns retrieved successfully",
          content: {
            "application/json": {
              schema: z.object({
                data: z.array(CampaignSchema),
                pagination: z.object({
                  page: z.number(),
                  limit: z.number(),
                  total: z.number(),
                  totalPages: z.number(),
                }),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const query = c.req.valid("query");

      try {
        const result = await campaignService.getAllCampaigns(
          query,
          organizationId
        );
        return c.json(result, 200);
      } catch (error) {
        console.error("Error getting campaigns:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // GET /campaigns/{campaign_id}
  // --------------------------------
  app.openapi(
    {
      method: "get",
      path: "/campaigns/{campaign_id}",
      tags: ["campaigns"],
      summary: "Get campaign by ID",
      description: "Get a single campaign with its creatives and shows",
      request: {
        params: CampaignParamsSchema,
      },
      responses: {
        200: {
          description: "Campaign retrieved successfully",
          content: {
            "application/json": {
              schema: CampaignWithDetailsSchema,
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");

      try {
        const campaign = await campaignService.getCampaignByIdWithDetails(
          campaign_id,
          organizationId
        );
        if (!campaign) {
          throw new HTTPException(404, { message: "Campaign not found" });
        }

        // Sign URLs in creatives if audioService is available
        if (audioService && campaign.creatives) {
          campaign.creatives = await Promise.all(
            campaign.creatives.map((creative) =>
              signUrlsInCreative(creative, audioService)
            )
          );
        }

        return c.json(campaign, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error getting campaign:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // POST /campaigns
  // --------------------------------
  app.openapi(
    {
      method: "post",
      path: "/campaigns",
      tags: ["campaigns"],
      summary: "Create campaign",
      description: "Create a new advertising campaign",
      request: {
        body: {
          content: {
            "application/json": {
              schema: CreateCampaignSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: "Campaign created successfully",
          content: {
            "application/json": {
              schema: CampaignSchema,
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const body = c.req.valid("json");

      try {
        const campaign = await campaignService.createCampaign(
          body,
          organizationId
        );
        return c.json(campaign, 201);
      } catch (error) {
        console.error("Error creating campaign:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // PUT /campaigns/{campaign_id}
  // --------------------------------
  app.openapi(
    {
      method: "put",
      path: "/campaigns/{campaign_id}",
      tags: ["campaigns"],
      summary: "Update campaign",
      description: "Update an existing campaign",
      request: {
        params: CampaignParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: UpdateCampaignSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: "Campaign updated successfully",
          content: {
            "application/json": {
              schema: CampaignSchema,
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");
      const body = c.req.valid("json");

      try {
        const campaign = await campaignService.updateCampaign(
          campaign_id,
          body,
          organizationId
        );
        return c.json(campaign, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error updating campaign:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // PATCH /campaigns/{campaign_id}
  // --------------------------------
  app.openapi(
    {
      method: "patch",
      path: "/campaigns/{campaign_id}",
      tags: ["campaigns"],
      summary: "Patch campaign",
      description:
        "Partially update an existing campaign (only provided fields will be updated)",
      request: {
        params: CampaignParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: UpdateCampaignSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: "Campaign updated successfully",
          content: {
            "application/json": {
              schema: CampaignSchema,
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");
      const body = c.req.valid("json");

      try {
        const campaign = await campaignService.updateCampaign(
          campaign_id,
          body,
          organizationId
        );
        return c.json(campaign, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error patching campaign:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // DELETE /campaigns/{campaign_id}
  // --------------------------------
  app.openapi(
    {
      method: "delete",
      path: "/campaigns/{campaign_id}",
      tags: ["campaigns"],
      summary: "Delete campaign",
      description: "Delete a campaign and all its creatives",
      request: {
        params: CampaignParamsSchema,
      },
      responses: {
        204: {
          description: "Campaign deleted successfully",
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");

      try {
        const deleted = await campaignService.deleteCampaign(
          campaign_id,
          organizationId
        );
        if (!deleted) {
          throw new HTTPException(404, { message: "Campaign not found" });
        }
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("Error deleting campaign:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // GET /campaigns/{campaign_id}/creatives
  // --------------------------------
  app.openapi(
    {
      method: "get",
      path: "/campaigns/{campaign_id}/creatives",
      tags: ["creatives"],
      summary: "Get campaign creatives",
      description: "Get all creatives for a campaign",
      request: {
        params: CampaignParamsSchema,
      },
      responses: {
        200: {
          description: "Creatives retrieved successfully",
          content: {
            "application/json": {
              schema: z.array(CreativeSchema),
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");

      try {
        const creatives = await campaignService.getCampaignCreatives(
          campaign_id,
          organizationId
        );

        // Sign audio URLs if audioService is available
        const signedCreatives = audioService
          ? await Promise.all(
              creatives.map((creative) =>
                signUrlsInCreative(creative, audioService)
              )
            )
          : creatives;

        return c.json(signedCreatives, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error getting campaign creatives:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // POST /campaigns/{campaign_id}/creatives
  // --------------------------------
  app.openapi(
    {
      method: "post",
      path: "/campaigns/{campaign_id}/creatives",
      tags: ["creatives"],
      summary: "Create creative",
      description: "Create a new creative for a campaign",
      request: {
        params: CampaignParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: CreateCreativeSchema.omit({ campaignId: true }),
            },
          },
        },
      },
      responses: {
        201: {
          description: "Creative created successfully",
          content: {
            "application/json": {
              schema: CreativeSchema,
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");
      const body = c.req.valid("json");

      try {
        const creative = await campaignService.createCreative(
          campaign_id,
          body,
          organizationId
        );

        // Sign URLs if audioService is available
        const signedCreative = audioService
          ? await signUrlsInCreative(creative, audioService)
          : creative;

        return c.json(signedCreative, 201);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error creating creative:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // GET /campaigns/{campaign_id}/creatives/{creative_id}
  // --------------------------------
  app.openapi(
    {
      method: "get",
      path: "/campaigns/{campaign_id}/creatives/{creative_id}",
      tags: ["creatives"],
      summary: "Get creative by ID",
      description: "Get a single creative",
      request: {
        params: CreativeParamsSchema,
      },
      responses: {
        200: {
          description: "Creative retrieved successfully",
          content: {
            "application/json": {
              schema: CreativeSchema,
            },
          },
        },
        404: {
          description: "Creative not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id, creative_id } = c.req.valid("param");

      try {
        const creative = await campaignService.getCreativeById(
          campaign_id,
          creative_id,
          organizationId
        );
        if (!creative) {
          throw new HTTPException(404, { message: "Creative not found" });
        }

        // Sign URLs if audioService is available
        const signedCreative = audioService
          ? await signUrlsInCreative(creative, audioService)
          : creative;

        return c.json(signedCreative, 200);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("Error getting creative:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // PUT /campaigns/{campaign_id}/creatives/{creative_id}
  // --------------------------------
  app.openapi(
    {
      method: "put",
      path: "/campaigns/{campaign_id}/creatives/{creative_id}",
      tags: ["creatives"],
      summary: "Update creative",
      description: "Update an existing creative (full update)",
      request: {
        params: CreativeParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: UpdateCreativeSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: "Creative updated successfully",
          content: {
            "application/json": {
              schema: CreativeSchema,
            },
          },
        },
        404: {
          description: "Creative not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id, creative_id } = c.req.valid("param");
      const body = c.req.valid("json");

      try {
        const creative = await campaignService.updateCreative(
          campaign_id,
          creative_id,
          body,
          organizationId
        );

        // Sign audio URL if audioService is available
        const signedCreative = audioService
          ? await signUrlsInCreative(creative, audioService)
          : creative;

        return c.json(signedCreative, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error updating creative:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // PATCH /campaigns/{campaign_id}/creatives/{creative_id}
  // --------------------------------
  app.openapi(
    {
      method: "patch",
      path: "/campaigns/{campaign_id}/creatives/{creative_id}",
      tags: ["creatives"],
      summary: "Patch creative",
      description: "Partially update an existing creative",
      request: {
        params: CreativeParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: UpdateCreativeSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: "Creative updated successfully",
          content: {
            "application/json": {
              schema: CreativeSchema,
            },
          },
        },
        404: {
          description: "Creative not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id, creative_id } = c.req.valid("param");
      const body = c.req.valid("json");

      try {
        const creative = await campaignService.updateCreative(
          campaign_id,
          creative_id,
          body,
          organizationId
        );

        // Sign audio URL if audioService is available
        const signedCreative = audioService
          ? await signUrlsInCreative(creative, audioService)
          : creative;

        return c.json(signedCreative, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error patching creative:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // DELETE /campaigns/{campaign_id}/creatives/{creative_id}
  // --------------------------------
  app.openapi(
    {
      method: "delete",
      path: "/campaigns/{campaign_id}/creatives/{creative_id}",
      tags: ["creatives"],
      summary: "Delete creative",
      description: "Delete a creative",
      request: {
        params: CreativeParamsSchema,
      },
      responses: {
        204: {
          description: "Creative deleted successfully",
        },
        404: {
          description: "Creative not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id, creative_id } = c.req.valid("param");

      try {
        const deleted = await campaignService.deleteCreative(
          campaign_id,
          creative_id,
          organizationId
        );
        if (!deleted) {
          throw new HTTPException(404, { message: "Creative not found" });
        }
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("Error deleting creative:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // --------------------------------
  // GET /campaigns/{campaign_id}/shows
  // --------------------------------
  app.openapi(
    {
      method: "get",
      path: "/campaigns/{campaign_id}/shows",
      tags: ["campaigns"],
      summary: "Get campaign shows",
      description: "Get all shows linked to a campaign",
      request: {
        params: CampaignParamsSchema,
      },
      responses: {
        200: {
          description: "Shows retrieved successfully",
          content: {
            "application/json": {
              schema: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  description: z.string(),
                  imageUrl: z.string().nullable(),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                })
              ),
            },
          },
        },
        404: {
          description: "Campaign not found",
          content: {
            "application/json": {
              schema: z.object({ message: z.string() }),
            },
          },
        },
      },
    },
    async (c) => {
      const payload = c.get("jwtPayload") as JWTPayload;

      // Extract organization ID from JWT payload
      const organizationId = getOrganizationId(payload);
      if (!organizationId) {
        const problem = {
          type: "forbidden",
          title: "Forbidden",
          status: 403,
          detail:
            "Organization context required. Please select an organization.",
          instance: c.req.path,
        };
        throw new HTTPException(403, { message: JSON.stringify(problem) });
      }

      const { campaign_id } = c.req.valid("param");

      try {
        const shows = await campaignService.getCampaignShows(
          campaign_id,
          organizationId
        );
        return c.json(shows, 200);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        console.error("Error getting campaign shows:", error);
        throw new HTTPException(500, { message: "Internal server error" });
      }
    }
  );

  // Creative upload routes
  if (creativeUploadService) {
    // --------------------------------
    // POST /campaigns/{campaign_id}/creatives/{creative_id}/audio
    // --------------------------------
    app.openapi(
      {
        method: "post",
        path: "/campaigns/{campaign_id}/creatives/{creative_id}/audio",
        tags: ["creatives"],
        summary: "Upload audio file for creative",
        description: "Upload an audio file for a creative",
        request: {
          params: CreativeParamsSchema,
          body: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    audio: {
                      type: "string",
                      format: "binary",
                      description: "Audio file to upload",
                    },
                  },
                  required: ["audio"],
                },
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: CreativeUploadSchema,
              },
            },
            description: "Audio uploaded successfully",
          },
          404: {
            description: "Creative not found",
          },
        },
        security: [{ Bearer: [] }],
      },
      async (c) => {
        // Check auth
        const payload = c.get("jwtPayload") as JWTPayload;
        const hasWritePermission = hasPermissions(payload, ["campaigns:write"]);
        const hasWriteScope = hasScopes(payload, ["campaigns.write"]);
        if (!hasWritePermission && !hasWriteScope) {
          const problem = {
            type: "forbidden",
            title: "Forbidden",
            status: 403,
            detail:
              "Required permissions: campaigns:write or scope: campaigns.write",
            instance: c.req.path,
          };
          throw new HTTPException(403, { message: JSON.stringify(problem) });
        }

        const { campaign_id, creative_id } = c.req.valid("param");

        try {
          // Parse multipart form data
          const formData = await c.req.formData();
          const audioFile = formData.get("audio") as File | null;

          if (!audioFile) {
            const problem = {
              type: "validation_error",
              title: "Validation Error",
              status: 400,
              detail: "Audio file is required",
              instance: c.req.path,
            };
            throw new HTTPException(400, { message: JSON.stringify(problem) });
          }

          // Convert File to Buffer
          const buffer = Buffer.from(await audioFile.arrayBuffer());

          const fileData = {
            fileName: audioFile.name,
            fileSize: audioFile.size,
            mimeType: audioFile.type,
            buffer,
          };

          const upload = await creativeUploadService.uploadCreativeAudio(
            campaign_id,
            creative_id,
            fileData
          );
          return c.json(upload, 201);
        } catch (error) {
          if (error instanceof NotFoundError) {
            const problem = {
              type: "not_found",
              title: "Not Found",
              status: 404,
              detail: "Creative not found",
              instance: c.req.path,
            };
            throw new HTTPException(404, { message: JSON.stringify(problem) });
          }

          // Log the actual error for debugging
          console.error("Creative audio upload error:", error);

          // Re-throw to let the global error handler deal with it
          throw error;
        }
      }
    );

    // --------------------------------
    // POST /campaigns/{campaign_id}/creatives/{creative_id}/video
    // --------------------------------
    app.openapi(
      {
        method: "post",
        path: "/campaigns/{campaign_id}/creatives/{creative_id}/video",
        tags: ["creatives"],
        summary: "Upload video file for creative",
        description: "Upload a video file for a creative",
        request: {
          params: CreativeParamsSchema,
          body: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    video: {
                      type: "string",
                      format: "binary",
                      description: "Video file to upload",
                    },
                  },
                  required: ["video"],
                },
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: CreativeUploadSchema,
              },
            },
            description: "Video uploaded successfully",
          },
          404: {
            description: "Creative not found",
          },
        },
        security: [{ Bearer: [] }],
      },
      async (c) => {
        // Check auth
        const payload = c.get("jwtPayload") as JWTPayload;
        const hasWritePermission = hasPermissions(payload, ["campaigns:write"]);
        const hasWriteScope = hasScopes(payload, ["campaigns.write"]);
        if (!hasWritePermission && !hasWriteScope) {
          const problem = {
            type: "forbidden",
            title: "Forbidden",
            status: 403,
            detail:
              "Required permissions: campaigns:write or scope: campaigns.write",
            instance: c.req.path,
          };
          throw new HTTPException(403, { message: JSON.stringify(problem) });
        }

        const { campaign_id, creative_id } = c.req.valid("param");

        try {
          // Parse multipart form data
          const formData = await c.req.formData();
          const videoFile = formData.get("video") as File | null;

          if (!videoFile) {
            const problem = {
              type: "validation_error",
              title: "Validation Error",
              status: 400,
              detail: "Video file is required",
              instance: c.req.path,
            };
            throw new HTTPException(400, { message: JSON.stringify(problem) });
          }

          // Convert File to Buffer
          const buffer = Buffer.from(await videoFile.arrayBuffer());

          const fileData = {
            fileName: videoFile.name,
            fileSize: videoFile.size,
            mimeType: videoFile.type,
            buffer,
          };

          const upload = await creativeUploadService.uploadCreativeVideo(
            campaign_id,
            creative_id,
            fileData
          );
          return c.json(upload, 201);
        } catch (error) {
          if (error instanceof NotFoundError) {
            const problem = {
              type: "not_found",
              title: "Not Found",
              status: 404,
              detail: "Creative not found",
              instance: c.req.path,
            };
            throw new HTTPException(404, { message: JSON.stringify(problem) });
          }

          // Log the actual error for debugging
          console.error("Creative video upload error:", error);

          // Re-throw to let the global error handler deal with it
          throw error;
        }
      }
    );

    // --------------------------------
    // POST /campaigns/{campaign_id}/creatives/{creative_id}/image
    // --------------------------------
    app.openapi(
      {
        method: "post",
        path: "/campaigns/{campaign_id}/creatives/{creative_id}/image",
        tags: ["creatives"],
        summary: "Upload image file for creative",
        description: "Upload an image file for a creative",
        request: {
          params: CreativeParamsSchema,
          body: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    image: {
                      type: "string",
                      format: "binary",
                      description: "Image file to upload",
                    },
                  },
                  required: ["image"],
                },
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: CreativeUploadSchema,
              },
            },
            description: "Image uploaded successfully",
          },
          404: {
            description: "Creative not found",
          },
        },
        security: [{ Bearer: [] }],
      },
      async (c) => {
        // Check auth
        const payload = c.get("jwtPayload") as JWTPayload;
        const hasWritePermission = hasPermissions(payload, ["campaigns:write"]);
        const hasWriteScope = hasScopes(payload, ["campaigns.write"]);
        if (!hasWritePermission && !hasWriteScope) {
          const problem = {
            type: "forbidden",
            title: "Forbidden",
            status: 403,
            detail:
              "Required permissions: campaigns:write or scope: campaigns.write",
            instance: c.req.path,
          };
          throw new HTTPException(403, { message: JSON.stringify(problem) });
        }

        const { campaign_id, creative_id } = c.req.valid("param");

        try {
          // Parse multipart form data
          const formData = await c.req.formData();
          const imageFile = formData.get("image") as File | null;

          if (!imageFile) {
            const problem = {
              type: "validation_error",
              title: "Validation Error",
              status: 400,
              detail: "Image file is required",
              instance: c.req.path,
            };
            throw new HTTPException(400, { message: JSON.stringify(problem) });
          }

          // Convert File to Buffer
          const buffer = Buffer.from(await imageFile.arrayBuffer());

          const fileData = {
            fileName: imageFile.name,
            fileSize: imageFile.size,
            mimeType: imageFile.type,
            buffer,
          };

          const upload = await creativeUploadService.uploadCreativeImage(
            campaign_id,
            creative_id,
            fileData
          );
          return c.json(upload, 201);
        } catch (error) {
          if (error instanceof NotFoundError) {
            const problem = {
              type: "not_found",
              title: "Not Found",
              status: 404,
              detail: "Creative not found",
              instance: c.req.path,
            };
            throw new HTTPException(404, { message: JSON.stringify(problem) });
          }

          // Log the actual error for debugging
          console.error("Creative image upload error:", error);

          // Re-throw to let the global error handler deal with it
          throw error;
        }
      }
    );
  }

  return app;
}
