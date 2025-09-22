import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  EpisodeSchema,
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  EpisodeParamsSchema,
  ShowParamsSchema,
  PaginationSchema,
  ImageUploadSchema,
} from "./schemas";
import { EpisodeService } from "./service";
import { AudioService } from "../audio/service";
import { ImageService } from "../images/service";
import { hasPermissions, hasScopes } from "../auth/middleware";
import { NotFoundError } from "../common/errors";
import { JWTPayload } from "../auth/types";

// Utility function to sign imageUrl in episode data
async function signImageUrlInEpisode(
  episode: any,
  imageService?: ImageService
) {
  if (
    !episode.imageUrl ||
    !episode.imageUrl.startsWith("r2://") ||
    !imageService
  ) {
    return episode;
  }

  try {
    // Extract the R2 key from the r2:// URL
    const r2Key = episode.imageUrl.replace("r2://", "");

    // Generate a fresh pre-signed URL
    const signedUrl = await imageService.signImageUrl(episode.imageUrl);

    if (signedUrl) {
      return {
        ...episode,
        imageUrl: signedUrl,
      };
    }
  } catch (error) {
    console.warn("Failed to sign imageUrl for episode:", episode.id, error);
  }

  return episode;
}

// Utility function to sign audioUrl in episode data
async function signAudioUrlInEpisode(
  episode: any,
  audioService?: AudioService
) {
  if (
    !episode.audioUrl ||
    !episode.audioUrl.startsWith("r2://") ||
    !audioService
  ) {
    return episode;
  }

  try {
    // Extract the R2 key from the r2:// URL
    const r2Key = episode.audioUrl.replace("r2://", "");

    // Generate a fresh pre-signed URL
    const signedUrl = await audioService.generateSignedUrlFromKey(r2Key);

    if (signedUrl) {
      return {
        ...episode,
        audioUrl: signedUrl,
      };
    }
  } catch (error) {
    console.warn("Failed to sign audioUrl for episode:", episode.id, error);
  }

  return episode;
}

// Get episodes for a show
const getEpisodesRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes",
  tags: ["episodes"],
  summary: "Get episodes",
  description: "Get all episodes for a show",
  request: {
    params: ShowParamsSchema,
    query: PaginationSchema,
  },
  responses: {
    200: {
      description: "Episodes retrieved successfully",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                showId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                audioUrl: { type: "string", nullable: true },
                transcriptUrl: { type: "string", nullable: true },
                published: { type: "boolean", nullable: true },
                publishedAt: { type: "string", nullable: true },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Get single episode
const getEpisodeRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}",
  tags: ["episodes"],
  summary: "Get episode",
  description: "Get a single episode by ID",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    200: {
      description: "Episode retrieved successfully",
      content: {
        "application/json": {
          schema: EpisodeSchema,
        },
      },
    },
    404: {
      description: "Episode not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Create episode
const createEpisodeRoute = createRoute({
  method: "post",
  path: "/shows/{show_id}/episodes",
  tags: ["episodes"],
  summary: "Create episode",
  description: "Create a new episode for a show",
  request: {
    params: ShowParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateEpisodeSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Episode created successfully",
      content: {
        "application/json": {
          schema: EpisodeSchema,
        },
      },
    },
    404: {
      description: "Show not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Update episode
const updateEpisodeRoute = createRoute({
  method: "patch",
  path: "/shows/{show_id}/episodes/{episode_id}",
  tags: ["episodes"],
  summary: "Update episode",
  description: "Update an existing episode",
  request: {
    params: EpisodeParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateEpisodeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Episode updated successfully",
      content: {
        "application/json": {
          schema: EpisodeSchema,
        },
      },
    },
    404: {
      description: "Episode not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Publish episode
const publishEpisodeRoute = createRoute({
  method: "post",
  path: "/shows/{show_id}/episodes/{episode_id}/publish",
  tags: ["episodes"],
  summary: "Publish episode",
  description: "Publish an episode to make it publicly available",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    200: {
      description: "Episode published successfully",
      content: {
        "application/json": {
          schema: EpisodeSchema,
        },
      },
    },
    404: {
      description: "Episode not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Delete episode
const deleteEpisodeRoute = createRoute({
  method: "delete",
  path: "/shows/{show_id}/episodes/{episode_id}",
  tags: ["episodes"],
  summary: "Delete episode",
  description: "Delete an episode",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    204: {
      description: "Episode deleted successfully",
    },
    404: {
      description: "Episode not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Upload episode image route
const uploadEpisodeImageRoute = createRoute({
  method: "post",
  path: "/shows/{show_id}/episodes/{episode_id}/image",
  tags: ["episodes"],
  summary: "Upload episode image",
  description: "Upload an image file for an episode",
  request: {
    params: EpisodeParamsSchema,
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
      description: "Episode not found",
    },
  },
  security: [{ Bearer: [] }],
});

// Get episode transcript
const getEpisodeTranscriptRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}/transcript",
  tags: ["episodes"],
  summary: "Get episode transcript",
  description: "Get the transcript of an episode in markdown format",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    200: {
      description: "Transcript retrieved successfully",
      content: {
        "text/markdown": {
          schema: {
            type: "string",
          },
        },
        "application/json": {
          schema: {
            type: "object",
            properties: {
              transcript: { type: "string" },
              episodeId: { type: "string" },
              title: { type: "string" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    404: {
      description: "Episode or transcript not found",
    },
    503: {
      description: "Transcript not available",
    },
  },
  security: [{ Bearer: [] }],
});

export function registerEpisodeRoutes(
  app: OpenAPIHono,
  episodeService: EpisodeService,
  audioService?: AudioService,
  imageService?: ImageService,
  bucket?: R2Bucket
) {
  // --------------------------------
  // GET /shows/{show_id}/episodes
  // --------------------------------
  app.openapi(getEpisodesRoute, async (c) => {
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
    const pagination = c.req.valid("query");
    const episodes = await episodeService.getEpisodesByShowId(
      show_id,
      pagination
    );

    // Sign audioUrl and imageUrl in episodes if they have r2:// URLs
    const signedEpisodes = await Promise.all(
      episodes.map(async (episode) => {
        let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
        signedEpisode = await signImageUrlInEpisode(
          signedEpisode,
          imageService
        );
        return signedEpisode;
      })
    );

    return c.json(signedEpisodes);
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(getEpisodeRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");
    const episode = await episodeService.getEpisodeById(show_id, episode_id);

    if (!episode) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Episode not found",
        instance: c.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    // Sign audioUrl and imageUrl if they have r2:// URLs
    let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
    signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);

    return c.json(signedEpisode);
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes
  // --------------------------------
  app.openapi(createEpisodeRoute, async (c) => {
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
    const episodeData = c.req.valid("json");

    // Get organization ID from JWT (payload already declared above)
    const organizationId = payload.org_id;
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

    try {
      const episode = await episodeService.createEpisode(
        show_id,
        episodeData,
        organizationId
      );

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);

      return c.json(signedEpisode, 201);
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

  // --------------------------------
  // PATCH /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(updateEpisodeRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");
    const updateData = c.req.valid("json");

    try {
      const episode = await episodeService.updateEpisode(
        show_id,
        episode_id,
        updateData
      );

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);

      return c.json(signedEpisode);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/publish
  // --------------------------------
  app.openapi(publishEpisodeRoute, async (c) => {
    const payload = c.get("jwtPayload") as JWTPayload;
    const hasPublishPermission = hasPermissions(payload, ["podcast:publish"]);
    const hasPublishScope = hasScopes(payload, ["podcast.publish"]);
    if (!hasPublishPermission && !hasPublishScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail:
          "Required permissions: podcast:publish or scope: podcast.publish",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = c.req.valid("param");

    try {
      const episode = await episodeService.publishEpisode(show_id, episode_id);

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);

      return c.json(signedEpisode);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // DELETE /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(deleteEpisodeRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");

    try {
      await episodeService.deleteEpisode(show_id, episode_id);
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/image
  // --------------------------------
  app.openapi(uploadEpisodeImageRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");

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

      const imageUpload = await imageService.uploadEpisodeImage(
        show_id,
        episode_id,
        imageFile
      );
      return c.json(imageUpload);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: error.message,
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

      throw error;
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/transcript
  // --------------------------------
  app.openapi(getEpisodeTranscriptRoute, async (c) => {
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

    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Transcript storage service is not available",
        instance: c.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = c.req.valid("param");

    try {
      // First, get the episode to check if transcript exists
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      if (!episode.transcriptUrl) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Transcript not available for this episode",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Extract R2 key from transcript URL
      // Format: https://podcast-media.sesamy.dev/transcripts/episode-id/transcript-id.txt
      // or r2://transcripts/episode-id/transcript-id.txt
      let transcriptKey: string;
      if (episode.transcriptUrl.startsWith("r2://")) {
        transcriptKey = episode.transcriptUrl.replace("r2://", "");
      } else {
        // Extract key from full URL
        const url = new URL(episode.transcriptUrl);
        const pathSegments = url.pathname.split("/");
        // Find transcripts segment and get everything after it
        const transcriptsIndex = pathSegments.indexOf("transcripts");
        if (transcriptsIndex === -1) {
          throw new Error("Invalid transcript URL format");
        }
        transcriptKey = pathSegments.slice(transcriptsIndex).join("/");
      }

      // Fetch transcript from R2
      const transcriptObject = await bucket.get(transcriptKey);

      if (!transcriptObject) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Transcript file not found in storage",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const transcriptText = await transcriptObject.text();

      // Check Accept header to determine response format
      const acceptHeader = c.req.header("Accept");
      const preferMarkdown =
        acceptHeader?.includes("text/markdown") ||
        acceptHeader?.includes("text/plain");

      if (preferMarkdown) {
        // Return as markdown
        const markdownContent = `# ${episode.title}\n\n**Episode ID:** ${
          episode.id
        }\n**Show:** ${episode.showId}\n**Created:** ${new Date(
          episode.createdAt
        ).toLocaleDateString()}\n\n---\n\n## Transcript\n\n${transcriptText}`;

        return new Response(markdownContent, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600", // Cache for 1 hour
          },
        });
      } else {
        // Return as JSON
        return c.json({
          transcript: transcriptText,
          episodeId: episode.id,
          title: episode.title,
          createdAt: episode.createdAt,
          transcriptUrl: episode.transcriptUrl,
        });
      }
    } catch (error: any) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error("Failed to fetch transcript:", error);

      if (error.message?.includes("not found")) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode or transcript not found",
          instance: c.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to retrieve transcript",
        instance: c.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });
}
