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
import type { AppContext } from "../auth/types";
import { getOrgId } from "../auth/helpers";
import { NotFoundError } from "../common/errors";

// Utility function to parse encodedAudioUrls from JSON string to object
function parseEncodedAudioUrls(episode: any) {
  if (
    episode.encodedAudioUrls &&
    typeof episode.encodedAudioUrls === "string"
  ) {
    try {
      return {
        ...episode,
        encodedAudioUrls: JSON.parse(episode.encodedAudioUrls),
      };
    } catch (error) {
      console.warn(
        "Failed to parse encodedAudioUrls for episode:",
        episode.id,
        error
      );
    }
  }
  return episode;
}

// Utility function to parse adMarkers from JSON string to array
function parseAdMarkers(episode: any) {
  if (episode.adMarkers && typeof episode.adMarkers === "string") {
    try {
      return {
        ...episode,
        adMarkers: JSON.parse(episode.adMarkers),
      };
    } catch (error) {
      console.warn("Failed to parse adMarkers for episode:", episode.id, error);
      return { ...episode, adMarkers: null };
    }
  }
  return episode;
}

// Utility function to parse chapters from JSON string to array
function parseChapters(episode: any) {
  if (episode.chapters && typeof episode.chapters === "string") {
    try {
      return {
        ...episode,
        chapters: JSON.parse(episode.chapters),
      };
    } catch (error) {
      console.warn("Failed to parse chapters for episode:", episode.id, error);
      return { ...episode, chapters: null };
    }
  }
  return episode;
}

// Utility function to parse all JSON fields in an episode
function parseEpisodeJsonFields(episode: any) {
  let parsed = parseEncodedAudioUrls(episode);
  parsed = parseAdMarkers(parsed);
  parsed = parseChapters(parsed);
  return parsed;
}

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

// Utility function to sign scriptUrl in episode data
// Note: Script URLs are now accessed via the /script endpoint with bearer auth
// So we don't need to sign them - just return the episode as-is
async function signScriptUrlInEpisode(
  episode: any,
  audioService?: AudioService
) {
  // Scripts are now accessed via authenticated API endpoint
  // No need to generate signed URLs
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
  security: [{ Bearer: ["podcast:read"] }],
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
  security: [{ Bearer: ["podcast:read"] }],
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
  security: [{ Bearer: ["podcast:write"] }],
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
  security: [{ Bearer: ["podcast:write"] }],
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
  security: [{ Bearer: ["podcast:publish"] }],
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
  security: [{ Bearer: ["podcast:write"] }],
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
  security: [{ Bearer: ["podcast:write"] }],
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
  security: [{ Bearer: ["podcast:read"] }],
});

// Get episode script
const getEpisodeScriptRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}/script",
  tags: ["episodes"],
  summary: "Get episode script",
  description: "Get the script of an episode in markdown format",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    200: {
      description: "Script retrieved successfully",
      content: {
        "text/markdown": {
          schema: {
            type: "string",
          },
        },
      },
    },
    404: {
      description: "Episode or script not found",
    },
    503: {
      description: "Script storage not available",
    },
  },
  security: [{ Bearer: ["podcast:read"] }],
});

// Update episode script
const putEpisodeScriptRoute = createRoute({
  method: "put",
  path: "/shows/{show_id}/episodes/{episode_id}/script",
  tags: ["episodes"],
  summary: "Update episode script",
  description: "Update or create the script for an episode",
  request: {
    params: EpisodeParamsSchema,
    body: {
      content: {
        "text/markdown": {
          schema: {
            type: "string",
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Script updated successfully",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              scriptUrl: { type: "string" },
              message: { type: "string" },
              taskId: {
                type: "number",
                description: "TTS generation task ID (if started)",
              },
            },
          },
        },
      },
    },
    404: {
      description: "Episode not found",
    },
    503: {
      description: "Script storage not available",
    },
  },
  security: [{ Bearer: ["podcast:write"] }],
});

// Get episode encoding metadata
const getEpisodeMetadataRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}/metadata",
  tags: ["episodes"],
  summary: "Get episode encoding metadata",
  description:
    "Get the encoding metadata for an episode (includes format details, bitrates, etc.)",
  request: {
    params: EpisodeParamsSchema,
  },
  responses: {
    200: {
      description: "Metadata retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            formats: z.array(
              z.object({
                format: z.string(),
                bitrate: z.number(),
                metadata: z.any(),
              })
            ),
          }),
        },
      },
    },
    404: {
      description: "Episode not found or metadata not available",
    },
    503: {
      description: "Storage not available",
    },
  },
  security: [{ Bearer: ["podcast:read"] }],
});

// Get episode audio with optional format/bitrate selection
const getEpisodeAudioRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}/audio",
  tags: ["episodes"],
  summary: "Get episode audio",
  description:
    "Stream episode audio file. Returns encoded audio if available, otherwise falls back to raw audio. Supports Range requests for seeking.",
  request: {
    params: EpisodeParamsSchema,
    query: z.object({
      format: z.enum(["mp3", "opus"]).optional().openapi({
        description:
          "Preferred audio format (mp3 or opus). Defaults to mp3 if available.",
      }),
      bitrate: z.coerce.number().optional().openapi({
        description:
          "Preferred bitrate in kbps (e.g., 128, 64). Defaults to highest available.",
      }),
    }),
  },
  responses: {
    200: {
      description: "Audio file stream",
      content: {
        "audio/mpeg": {
          schema: { type: "string", format: "binary" },
        },
        "audio/ogg": {
          schema: { type: "string", format: "binary" },
        },
      },
    },
    206: {
      description: "Partial content (for Range requests)",
      content: {
        "audio/mpeg": {
          schema: { type: "string", format: "binary" },
        },
        "audio/ogg": {
          schema: { type: "string", format: "binary" },
        },
      },
    },
    404: {
      description: "Episode or audio not found",
    },
    416: {
      description: "Range not satisfiable",
    },
    503: {
      description: "Storage not available",
    },
  },
  security: [{ Bearer: ["podcast:read"] }],
});

export function createEpisodeRoutes(
  episodeService: EpisodeService,
  audioService?: AudioService,
  imageService?: ImageService,
  bucket?: R2Bucket,
  ttsGenerationWorkflow?: Workflow
) {
  const app = new OpenAPIHono<AppContext>();

  // --------------------------------
  // GET /shows/{show_id}/episodes
  // --------------------------------
  app.openapi(getEpisodesRoute, async (ctx) => {
    // Check auth - look for permissions first, then fall back to scopes
    const { show_id } = ctx.req.valid("param");
    const pagination = ctx.req.valid("query");
    const episodes = await episodeService.getEpisodesByShowId(
      show_id,
      pagination
    );

    // Sign audioUrl, imageUrl, and scriptUrl in episodes if they have r2:// URLs
    const signedEpisodes = await Promise.all(
      episodes.map(async (episode) => {
        let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
        signedEpisode = await signImageUrlInEpisode(
          signedEpisode,
          imageService
        );
        signedEpisode = await signScriptUrlInEpisode(
          signedEpisode,
          audioService
        );
        // Parse JSON fields (encodedAudioUrls, adMarkers, chapters)
        signedEpisode = parseEpisodeJsonFields(signedEpisode);
        return signedEpisode;
      })
    );

    return ctx.json(signedEpisodes);
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(getEpisodeRoute, async (ctx) => {
    // Check auth - look for permissions first, then fall back to scopes
    const { show_id, episode_id } = ctx.req.valid("param");
    const episode = await episodeService.getEpisodeById(show_id, episode_id);

    if (!episode) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Episode not found",
        instance: ctx.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    // Sign audioUrl, imageUrl, and scriptUrl if they have r2:// URLs
    let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
    signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);
    signedEpisode = await signScriptUrlInEpisode(signedEpisode, audioService);
    // Parse JSON fields (encodedAudioUrls, adMarkers, chapters)
    signedEpisode = parseEpisodeJsonFields(signedEpisode);

    return ctx.json(signedEpisode);
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes
  // --------------------------------
  app.openapi(createEpisodeRoute, async (ctx) => {
    const { show_id } = ctx.req.valid("param");
    const episodeData = ctx.req.valid("json");

    // Get organization ID from JWT
    const organizationId = getOrgId(ctx);

    try {
      const episode = await episodeService.createEpisode(
        show_id,
        episodeData,
        organizationId
      );

      // If scriptUrl is provided, create a TTS generation task
      if (episodeData.scriptUrl && audioService && ttsGenerationWorkflow) {
        try {
          // Import TaskService
          const { TaskService } = await import("../tasks/service.js");

          // Get the database from audioService (we need to access it)
          const database = (audioService as any).database;

          // Create a TaskService instance with TTS workflow binding
          const taskService = new TaskService(
            database,
            undefined, // audioProcessingWorkflow
            undefined, // importShowWorkflow
            ttsGenerationWorkflow
          );

          // Create a TTS generation task
          const ttsTask = await taskService.createTask(
            "tts_generation",
            {
              episodeId: episode.id,
              scriptUrl: episodeData.scriptUrl,
              organizationId,
            },
            organizationId
          );

          console.log(
            `Created TTS generation task ${ttsTask.id} for episode ${episode.id}`
          );
        } catch (ttsError) {
          // Log the error but don't fail the episode creation
          console.error("Failed to create TTS generation task:", ttsError);
        }
      }

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);
      signedEpisode = await signScriptUrlInEpisode(signedEpisode, audioService);
      // Parse encodedAudioUrls from JSON string to object
      signedEpisode = parseEpisodeJsonFields(signedEpisode);

      return ctx.json(signedEpisode, 201);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Show not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // PATCH /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(updateEpisodeRoute, async (ctx) => {
    const { show_id, episode_id } = ctx.req.valid("param");
    const updateData = ctx.req.valid("json");

    try {
      const episode = await episodeService.updateEpisode(
        show_id,
        episode_id,
        updateData
      );

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);
      signedEpisode = await signScriptUrlInEpisode(signedEpisode, audioService);
      // Parse encodedAudioUrls from JSON string to object
      signedEpisode = parseEpisodeJsonFields(signedEpisode);

      return ctx.json(signedEpisode);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/publish
  // --------------------------------
  app.openapi(publishEpisodeRoute, async (ctx) => {
    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      const episode = await episodeService.publishEpisode(show_id, episode_id);

      // Sign URLs if they have r2:// URLs
      let signedEpisode = await signAudioUrlInEpisode(episode, audioService);
      signedEpisode = await signImageUrlInEpisode(signedEpisode, imageService);
      signedEpisode = await signScriptUrlInEpisode(signedEpisode, audioService);
      // Parse encodedAudioUrls from JSON string to object
      signedEpisode = parseEpisodeJsonFields(signedEpisode);

      return ctx.json(signedEpisode);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // DELETE /shows/{show_id}/episodes/{episode_id}
  // --------------------------------
  app.openapi(deleteEpisodeRoute, async (ctx) => {
    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      await episodeService.deleteEpisode(show_id, episode_id);
      return ctx.body(null, 204);
    } catch (error) {
      if (error instanceof NotFoundError) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }
      throw error;
    }
  });

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/image
  // --------------------------------
  app.openapi(uploadEpisodeImageRoute, async (ctx) => {
    // Check authorization
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

    const { show_id, episode_id } = ctx.req.valid("param");

    try {
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

      const imageUpload = await imageService.uploadEpisodeImage(
        show_id,
        episode_id,
        imageFile
      );
      return ctx.json(imageUpload);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: error.message,
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

      throw error;
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/transcript
  // --------------------------------
  app.openapi(getEpisodeTranscriptRoute, async (ctx) => {
    // Check auth - look for permissions first, then fall back to scopes
    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Transcript storage service is not available",
        instance: ctx.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      // First, get the episode to check if transcript exists
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      if (!episode.transcriptUrl) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Transcript not available for this episode",
          instance: ctx.req.path,
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
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const transcriptText = await transcriptObject.text();

      // Check Accept header to determine response format
      const acceptHeader = ctx.req.header("Accept");
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
        return ctx.json({
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
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to retrieve transcript",
        instance: ctx.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  // GET /shows/{show_id}/episodes/{episode_id}/script
  // --------------------------------
  app.openapi(getEpisodeScriptRoute, async (ctx) => {
    // Check auth - look for permissions first, then fall back to scopes
    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Script storage service is not available",
        instance: ctx.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      // First, get the episode to check if script exists
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      if (!episode.scriptUrl) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Script not available for this episode",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Extract R2 key from script URL
      // Format: https://podcast-media.sesamy.dev/scripts/org-id/show-id/episode-id/script.md
      // or r2://scripts/org-id/show-id/episode-id/script.md
      let scriptKey: string;
      if (episode.scriptUrl.startsWith("r2://")) {
        scriptKey = episode.scriptUrl.replace("r2://", "");
      } else {
        // Extract key from full URL
        const url = new URL(episode.scriptUrl);
        const pathSegments = url.pathname.split("/");
        // Find scripts segment and get everything after it
        const scriptsIndex = pathSegments.indexOf("scripts");
        if (scriptsIndex === -1) {
          throw new Error("Invalid script URL format");
        }
        scriptKey = pathSegments.slice(scriptsIndex).join("/");
      }

      // Fetch script from R2
      const scriptObject = await bucket.get(scriptKey);

      if (!scriptObject) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Script file not found in storage",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const scriptText = await scriptObject.text();

      // Always return as markdown with proper headers
      return new Response(scriptText, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "private, max-age=3600", // Cache for 1 hour (private because it's authenticated)
          "Content-Disposition": `inline; filename="${episode.id}-script.md"`,
        },
      });
    } catch (error: any) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error("Failed to fetch script:", error);

      if (error.message?.includes("not found")) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode or script not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to retrieve script",
        instance: ctx.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  // PUT /shows/{show_id}/episodes/{episode_id}/script
  // --------------------------------
  app.openapi(putEpisodeScriptRoute, async (ctx) => {
    // Check auth - look for permissions first, then fall back to scopes
    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Script storage service is not available",
        instance: ctx.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      // First, get the episode to ensure it exists
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Get the markdown content from the request body
      const scriptContent = await ctx.req.text();

      if (!scriptContent || scriptContent.trim().length === 0) {
        const problem = {
          type: "bad_request",
          title: "Bad Request",
          status: 400,
          detail: "Script content cannot be empty",
          instance: ctx.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      // Generate script key - use existing key if available, or create new one
      let scriptKey: string;
      if (episode.scriptUrl) {
        // Extract existing key
        if (episode.scriptUrl.startsWith("r2://")) {
          scriptKey = episode.scriptUrl.replace("r2://", "");
        } else {
          const url = new URL(episode.scriptUrl);
          const pathSegments = url.pathname.split("/");
          const scriptsIndex = pathSegments.indexOf("scripts");
          if (scriptsIndex !== -1) {
            scriptKey = pathSegments.slice(scriptsIndex).join("/");
          } else {
            // Create new key if existing URL is invalid
            scriptKey = `scripts/${episode.organizationId}/${show_id}/${episode_id}/script.md`;
          }
        }
      } else {
        // Create new key
        scriptKey = `scripts/${episode.organizationId}/${show_id}/${episode_id}/script.md`;
      }

      // Upload script to R2
      await bucket.put(scriptKey, scriptContent, {
        httpMetadata: {
          contentType: "text/markdown",
        },
      });

      const scriptUrl = `r2://${scriptKey}`;

      // Update episode with scriptUrl
      await episodeService.updateEpisode(show_id, episode_id, {
        scriptUrl: scriptUrl,
      });

      // Create a TTS generation task if workflow is available
      if (audioService && ttsGenerationWorkflow) {
        try {
          // Import TaskService
          const { TaskService } = await import("../tasks/service.js");

          // Get the database from audioService
          const database = (audioService as any).database;

          // Create a TaskService instance with TTS workflow binding
          const taskService = new TaskService(
            database,
            undefined, // audioProcessingWorkflow
            undefined, // importShowWorkflow
            ttsGenerationWorkflow
          );

          // Create a TTS generation task
          const ttsTask = await taskService.createTask(
            "tts_generation",
            {
              episodeId: episode_id,
              scriptUrl: scriptUrl,
              organizationId: episode.organizationId,
            },
            episode.organizationId
          );

          // Return response with task information
          return ctx.json({
            success: true,
            scriptUrl: scriptUrl,
            message: "Script updated successfully and TTS generation started",
            taskId: ttsTask.id,
          });
        } catch (ttsError) {
          // Log the error but don't fail the script update
          console.error("Failed to create TTS generation task:", ttsError);
          // Return without task info if TTS creation fails
        }
      }

      return ctx.json({
        success: true,
        scriptUrl: scriptUrl,
        message: "Script updated successfully",
      });
    } catch (error: any) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error("Failed to update script:", error);

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to update script",
        instance: ctx.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/metadata
  // --------------------------------
  app.openapi(getEpisodeMetadataRoute, async (ctx) => {
    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Storage service is not available",
        instance: ctx.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      // First, verify the episode exists
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Parse encodedAudioUrls to get available formats
      const encodedAudioUrls = episode.encodedAudioUrls
        ? typeof episode.encodedAudioUrls === "string"
          ? JSON.parse(episode.encodedAudioUrls)
          : episode.encodedAudioUrls
        : null;

      if (!encodedAudioUrls || Object.keys(encodedAudioUrls).length === 0) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "No encoding metadata available for this episode",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Fetch metadata for each format
      const formats = [];
      for (const [formatKey, audioUrl] of Object.entries(encodedAudioUrls)) {
        // Parse format key (e.g., "mp3_128" or "opus_64")
        const [format, bitrateStr] = formatKey.split("_");
        const bitrate = parseInt(bitrateStr);

        // Construct metadata R2 key
        const metadataR2Key = `episodes/${episode_id}/audio_${bitrate}kbps_metadata.json`;

        try {
          // Fetch metadata from R2
          const metadataObject = await bucket.get(metadataR2Key);

          if (metadataObject) {
            const metadataText = await metadataObject.text();
            const metadata = JSON.parse(metadataText);

            formats.push({
              format,
              bitrate,
              metadata,
            });
          }
        } catch (metadataError) {
          console.warn(
            `Failed to fetch metadata for ${formatKey}:`,
            metadataError
          );
          // Continue with other formats even if one fails
        }
      }

      if (formats.length === 0) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "No metadata files found in storage",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      return ctx.json({ formats });
    } catch (error: any) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error("Failed to fetch metadata:", error);

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to retrieve metadata",
        instance: ctx.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/audio
  // --------------------------------
  app.openapi(getEpisodeAudioRoute, async (ctx) => {
    if (!bucket) {
      const problem = {
        type: "service_unavailable",
        title: "Service Unavailable",
        status: 503,
        detail: "Storage service is not available",
        instance: ctx.req.path,
      };
      throw new HTTPException(503, { message: JSON.stringify(problem) });
    }

    const { show_id, episode_id } = ctx.req.valid("param");
    const { format, bitrate } = ctx.req.valid("query");

    try {
      // Get the episode
      const episode = await episodeService.getEpisodeById(show_id, episode_id);

      if (!episode || episode.showId !== show_id) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Episode not found",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Parse encodedAudioUrls to find the best match
      const encodedAudioUrls = episode.encodedAudioUrls
        ? typeof episode.encodedAudioUrls === "string"
          ? JSON.parse(episode.encodedAudioUrls)
          : episode.encodedAudioUrls
        : null;

      console.log("Episode audio info:", {
        episodeId: episode_id,
        hasEncodedUrls: !!encodedAudioUrls,
        encodedUrlKeys: encodedAudioUrls ? Object.keys(encodedAudioUrls) : [],
        audioUrl: episode.audioUrl,
        requestedFormat: format,
        requestedBitrate: bitrate,
      });

      let audioR2Key: string | null = null;
      let contentType = "audio/mpeg"; // default

      // Try to find encoded audio based on preferences
      if (encodedAudioUrls && Object.keys(encodedAudioUrls).length > 0) {
        // Build a list of available formats with their keys
        const availableFormats = Object.entries(encodedAudioUrls).map(
          ([key, value]) => {
            // Parse format key - could be "mp3_128" or "mp3_128kbps"
            const parts = key.split("_");
            const fmt = parts[0];
            const bitrateStr = parts[1]?.replace("kbps", "") || "128";

            // Handle both string URLs and objects with url property
            let urlValue: string;
            if (typeof value === "string") {
              urlValue = value;
            } else if (value && typeof value === "object" && "url" in value) {
              urlValue = String((value as any).url);
            } else {
              urlValue = String(value);
            }

            return {
              key,
              format: fmt,
              bitrate: parseInt(bitrateStr),
              url: urlValue,
            };
          }
        );

        // Filter by format if specified
        let candidates = format
          ? availableFormats.filter((f) => f.format === format)
          : availableFormats;

        // If no format specified, prefer mp3
        if (!format && candidates.length > 0) {
          const mp3Options = candidates.filter((f) => f.format === "mp3");
          if (mp3Options.length > 0) {
            candidates = mp3Options;
          }
        }

        // Filter by bitrate if specified
        if (bitrate && candidates.length > 0) {
          const exactMatch = candidates.find((f) => f.bitrate === bitrate);
          if (exactMatch) {
            candidates = [exactMatch];
          }
        }

        // Pick the highest bitrate from remaining candidates
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.bitrate - a.bitrate);
          const selected = candidates[0];

          console.log("Selected encoded audio:", {
            format: selected.format,
            bitrate: selected.bitrate,
            url: selected.url,
          });

          // Extract R2 key from URL
          if (selected.url.startsWith("r2://")) {
            audioR2Key = selected.url.replace("r2://", "");
          } else if (
            selected.url.startsWith("http://") ||
            selected.url.startsWith("https://")
          ) {
            // Extract from full URL
            try {
              const url = new URL(selected.url);
              audioR2Key = url.pathname.substring(1); // Remove leading slash
            } catch (urlError) {
              console.error(
                "Failed to parse encoded audio URL:",
                selected.url,
                urlError
              );
            }
          } else {
            // Assume it's already an R2 key
            audioR2Key = selected.url;
          }

          // Set content type based on format
          contentType = selected.format === "opus" ? "audio/ogg" : "audio/mpeg";
        }
      }

      // Fall back to raw audio if no encoded version found
      if (!audioR2Key && episode.audioUrl) {
        if (episode.audioUrl.startsWith("r2://")) {
          audioR2Key = episode.audioUrl.replace("r2://", "");
        } else if (
          episode.audioUrl.startsWith("http://") ||
          episode.audioUrl.startsWith("https://")
        ) {
          // Parse the R2 key from the full URL
          try {
            const url = new URL(episode.audioUrl);
            // Remove leading slash from pathname to get R2 key
            audioR2Key = url.pathname.substring(1);
          } catch (urlError) {
            console.error(
              "Failed to parse audio URL:",
              episode.audioUrl,
              urlError
            );
          }
        } else {
          // Assume it's already an R2 key
          audioR2Key = episode.audioUrl;
        }
        // Try to infer content type from extension
        if (
          audioR2Key &&
          (audioR2Key.endsWith(".opus") || audioR2Key.endsWith(".ogg"))
        ) {
          contentType = "audio/ogg";
        }
      }

      console.log("Audio R2 key resolved:", {
        audioR2Key,
        contentType,
      });

      if (!audioR2Key) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "No audio file available for this episode",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Get Range header for partial content support
      const rangeHeader = ctx.req.header("Range");

      // Fetch audio from R2
      const options: R2GetOptions = {};
      if (rangeHeader) {
        options.range = ctx.req.raw.headers as any;
      }

      const audioObject = await bucket.get(audioR2Key, options);

      if (!audioObject) {
        const problem = {
          type: "not_found",
          title: "Not Found",
          status: 404,
          detail: "Audio file not found in storage",
          instance: ctx.req.path,
        };
        throw new HTTPException(404, { message: JSON.stringify(problem) });
      }

      // Prepare response headers
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      };

      // Handle Range request
      if (rangeHeader && audioObject.range) {
        const range = audioObject.range;
        let start: number;
        let end: number;
        let length: number;

        // R2Range can be {offset?: number, length: number} or {suffix: number}
        if ("suffix" in range) {
          // suffix range - last N bytes
          length = range.suffix;
          start = audioObject.size - length;
          end = audioObject.size - 1;
        } else {
          // offset/length range
          start = range.offset ?? 0;
          length = range.length ?? audioObject.size - start;
          end = start + length - 1;
        }

        headers["Content-Range"] = `bytes ${start}-${end}/${audioObject.size}`;
        headers["Content-Length"] = length.toString();

        return new Response(audioObject.body, {
          status: 206,
          headers,
        });
      }

      // Full content response
      headers["Content-Length"] = audioObject.size.toString();

      return new Response(audioObject.body, {
        status: 200,
        headers,
      });
    } catch (error: any) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error("Failed to stream audio:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        episodeId: episode_id,
        showId: show_id,
      });

      const problem = {
        type: "internal_server_error",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to retrieve audio",
        instance: ctx.req.path,
      };
      throw new HTTPException(500, { message: JSON.stringify(problem) });
    }
  });

  return app;
}
