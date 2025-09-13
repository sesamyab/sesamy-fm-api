import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
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
  AudioUploadSchema,
} from "./schemas";
import { CampaignService } from "./service";
import { AudioService } from "../audio/service";
import { requireScopes, hasPermissions, hasScopes } from "../auth/middleware";
import { NotFoundError } from "../common/errors";
import { JWTPayload } from "../auth/types";

// Utility function to sign audio URLs in creatives
async function signAudioUrlInCreative(
  creative: any,
  audioService?: AudioService
) {
  if (
    !creative.fileUrl ||
    !creative.fileUrl.startsWith("r2://") ||
    !audioService
  ) {
    return creative;
  }

  try {
    // Extract the R2 key from the r2:// URL
    const r2Key = creative.fileUrl.replace("r2://", "");

    // Generate a fresh pre-signed URL
    const signedUrl = await audioService.generateSignedUrlFromKey(r2Key);

    if (signedUrl) {
      return {
        ...creative,
        fileUrl: signedUrl,
      };
    }
  } catch (error) {
    console.warn("Failed to sign fileUrl for creative:", creative.id, error);
  }

  return creative;
}

// Get campaigns
const getCampaignsRoute = createRoute({
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
});

// Get campaign by ID
const getCampaignRoute = createRoute({
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
});

// Create campaign
const createCampaignRoute = createRoute({
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
});

// Update campaign
const updateCampaignRoute = createRoute({
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
});

// Patch campaign (partial update)
const patchCampaignRoute = createRoute({
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
});

// Delete campaign
const deleteCampaignRoute = createRoute({
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
});

// Get campaign creatives
const getCampaignCreativesRoute = createRoute({
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
});

// Create creative
const createCreativeRoute = createRoute({
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
});

// Get creative by ID
const getCreativeRoute = createRoute({
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
});

// Update creative (full update)
const updateCreativeRoute = createRoute({
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
});

// Patch creative (partial update)
const patchCreativeRoute = createRoute({
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
});

// Delete creative
const deleteCreativeRoute = createRoute({
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
});

// Note: Audio upload functionality to be implemented later

// Get campaign shows
const getCampaignShowsRoute = createRoute({
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
});

export function createCampaignRoutes(
  campaignService: CampaignService,
  audioService?: AudioService
) {
  const app = new OpenAPIHono();

  // Apply authentication middleware
  app.use("*", requireScopes(["campaigns:read", "campaigns:write"]));

  // Campaign routes
  app.openapi(getCampaignsRoute, async (c) => {
    const query = c.req.valid("query");

    try {
      const result = await campaignService.getAllCampaigns(query);
      return c.json(result, 200);
    } catch (error) {
      console.error("Error getting campaigns:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(getCampaignRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");

    try {
      const campaign = await campaignService.getCampaignByIdWithDetails(
        campaign_id
      );
      if (!campaign) {
        throw new HTTPException(404, { message: "Campaign not found" });
      }

      // Sign audio URLs in creatives if audioService is available
      if (audioService && campaign.creatives) {
        campaign.creatives = await Promise.all(
          campaign.creatives.map((creative) =>
            signAudioUrlInCreative(creative, audioService)
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
  });

  app.openapi(createCampaignRoute, async (c) => {
    const body = c.req.valid("json");

    try {
      const campaign = await campaignService.createCampaign(body);
      return c.json(campaign, 201);
    } catch (error) {
      console.error("Error creating campaign:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(updateCampaignRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const campaign = await campaignService.updateCampaign(campaign_id, body);
      return c.json(campaign, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error updating campaign:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(patchCampaignRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const campaign = await campaignService.updateCampaign(campaign_id, body);
      return c.json(campaign, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error patching campaign:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(deleteCampaignRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");

    try {
      const deleted = await campaignService.deleteCampaign(campaign_id);
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
  });

  // Creative routes
  app.openapi(getCampaignCreativesRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");

    try {
      const creatives = await campaignService.getCampaignCreatives(campaign_id);

      // Sign audio URLs if audioService is available
      const signedCreatives = audioService
        ? await Promise.all(
            creatives.map((creative) =>
              signAudioUrlInCreative(creative, audioService)
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
  });

  app.openapi(createCreativeRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const creative = await campaignService.createCreative(campaign_id, body);

      // Sign audio URL if audioService is available
      const signedCreative = audioService
        ? await signAudioUrlInCreative(creative, audioService)
        : creative;

      return c.json(signedCreative, 201);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error creating creative:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(getCreativeRoute, async (c) => {
    const { campaign_id, creative_id } = c.req.valid("param");

    try {
      const creative = await campaignService.getCreativeById(
        campaign_id,
        creative_id
      );
      if (!creative) {
        throw new HTTPException(404, { message: "Creative not found" });
      }

      // Sign audio URL if audioService is available
      const signedCreative = audioService
        ? await signAudioUrlInCreative(creative, audioService)
        : creative;

      return c.json(signedCreative, 200);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("Error getting creative:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(updateCreativeRoute, async (c) => {
    const { campaign_id, creative_id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const creative = await campaignService.updateCreative(
        campaign_id,
        creative_id,
        body
      );

      // Sign audio URL if audioService is available
      const signedCreative = audioService
        ? await signAudioUrlInCreative(creative, audioService)
        : creative;

      return c.json(signedCreative, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error updating creative:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(patchCreativeRoute, async (c) => {
    const { campaign_id, creative_id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const creative = await campaignService.updateCreative(
        campaign_id,
        creative_id,
        body
      );

      // Sign audio URL if audioService is available
      const signedCreative = audioService
        ? await signAudioUrlInCreative(creative, audioService)
        : creative;

      return c.json(signedCreative, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error patching creative:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  app.openapi(deleteCreativeRoute, async (c) => {
    const { campaign_id, creative_id } = c.req.valid("param");

    try {
      const deleted = await campaignService.deleteCreative(
        campaign_id,
        creative_id
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
  });

  // Note: Audio upload functionality to be implemented later

  // Campaign shows
  app.openapi(getCampaignShowsRoute, async (c) => {
    const { campaign_id } = c.req.valid("param");

    try {
      const shows = await campaignService.getCampaignShows(campaign_id);
      return c.json(shows, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error getting campaign shows:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });

  return app;
}
