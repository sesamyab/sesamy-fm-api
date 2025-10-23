/// <reference types="@cloudflare/workers-types" />

import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import {
  AudioUploadSchema,
  AudioParamsSchema,
  InitiateMultipartUploadSchema,
  MultipartUploadResponseSchema,
  CompleteMultipartUploadSchema,
  ChunkParamsSchema,
  ChunkUploadResponseSchema,
} from "./schemas";
import { AudioService } from "./service";
import { NotFoundError } from "../common/errors";
import type { AppContext } from "../auth/types";
import { getOrgId } from "../auth/helpers";

// Upload audio route
const uploadAudioRoute = createRoute({
  method: "post",
  path: "/shows/{show_id}/episodes/{episode_id}/audio",
  tags: ["audio"],
  summary: "Upload audio or script file",
  description:
    "Upload an audio file or markdown script file for an episode. If a markdown file is uploaded, it will trigger TTS generation.",
  request: {
    params: AudioParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              audio: {
                type: "string",
                format: "binary",
                description:
                  "Audio file to upload (mp3, wav, etc.) or markdown script file (.md) for TTS generation",
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
          schema: AudioUploadSchema,
        },
      },
      description: "Audio uploaded successfully or TTS generation started",
    },
    404: {
      description: "Episode not found",
    },
  },
  security: [{ Bearer: ["podcast:write"] }],
});

// Get audio metadata route
const getAudioRoute = createRoute({
  method: "get",
  path: "/shows/{show_id}/episodes/{episode_id}/audio",
  tags: ["audio"],
  summary: "Get audio metadata",
  description: "Get metadata for an episode's audio file",
  request: {
    params: AudioParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AudioUploadSchema,
        },
      },
      description: "Audio metadata",
    },
    404: {
      description: "Audio or episode not found",
    },
  },
  security: [{ Bearer: ["podcast:read"] }],
});

export function createAudioRoutes(audioService: AudioService) {
  const app = new OpenAPIHono<AppContext>();

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/audio
  // --------------------------------
  app.openapi(uploadAudioRoute, async (ctx) => {
    const { show_id, episode_id } = ctx.req.valid("param");

    try {
      // Parse multipart form data
      const formData = await ctx.req.formData();
      const audioFile = formData.get("audio") as File | null;

      if (!audioFile) {
        const problem = {
          type: "validation_error",
          title: "Validation Error",
          status: 400,
          detail: "Audio file is required",
          instance: ctx.req.path,
        };
        throw new HTTPException(400, { message: JSON.stringify(problem) });
      }

      // Check if it's a markdown file
      const isMarkdown =
        audioFile.type === "text/markdown" ||
        audioFile.name.endsWith(".md") ||
        audioFile.name.endsWith(".markdown");

      if (isMarkdown) {
        // Handle markdown file - store as script and trigger TTS
        console.log(
          `Markdown file detected: ${audioFile.name}, triggering TTS workflow`
        );

        // Get ArrayBuffer directly (no need for Node Buffer in Workers)
        const arrayBuffer = await audioFile.arrayBuffer();

        // Store the markdown file in R2
        const scriptId = (await import("uuid")).v4();
        const scriptKey = `scripts/${show_id}/${episode_id}/${scriptId}/${audioFile.name}`;

        // Upload to R2
        if (audioService["bucket"]) {
          await audioService["bucket"].put(scriptKey, arrayBuffer, {
            httpMetadata: {
              contentType: audioFile.type || "text/markdown",
            },
          });

          const scriptUrl = `r2://${scriptKey}`;

          // Update episode with scriptUrl
          const episodeRepo = audioService["episodeRepo"];
          await episodeRepo.update(show_id, episode_id, {
            scriptUrl: scriptUrl,
          });

          // Generate a presigned URL for the TTS workflow to fetch
          let accessibleScriptUrl = scriptUrl;
          try {
            const presignedUrl =
              await audioService.generatePresignedUrlWithCors(scriptKey);
            if (presignedUrl) {
              accessibleScriptUrl = presignedUrl;
            }
          } catch (error) {
            console.warn("Failed to generate presigned URL for script:", error);
          }

          // Create TTS generation task
          try {
            const { TaskService } = await import("../tasks/service.js");
            const database = audioService["database"];
            const organizationId = getOrgId(ctx);

            // Get TTS workflow binding from context if available
            const ttsWorkflow = (
              ctx.env as { TTS_GENERATION_WORKFLOW?: Workflow }
            )?.TTS_GENERATION_WORKFLOW;

            const taskService = new TaskService(
              database,
              undefined, // audioProcessingWorkflow
              undefined, // importShowWorkflow
              ttsWorkflow
            );

            const ttsTask = await taskService.createTask(
              "tts_generation",
              {
                episodeId: episode_id,
                scriptUrl: accessibleScriptUrl,
                model: "@cf/deepgram/aura-1",
                organizationId,
              },
              organizationId
            );

            console.log(
              `Created TTS generation task ${ttsTask.id} for episode ${episode_id}`
            );
          } catch (ttsError) {
            console.error("Failed to create TTS generation task:", ttsError);
          }

          // Return a success response indicating TTS is starting
          return ctx.json(
            {
              id: scriptId,
              episodeId: episode_id,
              fileName: audioFile.name,
              fileSize: audioFile.size,
              mimeType: audioFile.type || "text/markdown",
              url: scriptUrl,
              uploadedAt: new Date().toISOString(),
              message: "Script uploaded successfully. TTS generation started.",
            },
            201
          );
        } else {
          throw new Error("Storage service not available");
        }
      } else {
        // Handle regular audio file
        const arrayBuffer = await audioFile.arrayBuffer();

        const fileData = {
          fileName: audioFile.name,
          fileSize: audioFile.size,
          mimeType: audioFile.type,
          buffer: arrayBuffer,
        };

        const upload = await audioService.uploadAudio(
          show_id,
          episode_id,
          fileData
        );
        return ctx.json(upload, 201);
      }
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

      // Log the actual error for debugging
      console.error("Audio upload error:", error);

      // Re-throw to let the global error handler deal with it
      throw error;
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/audio
  // --------------------------------
  app.openapi(getAudioRoute, async (ctx) => {
    const { show_id, episode_id } = ctx.req.valid("param");
    const audio = await audioService.getAudioMetadata(show_id, episode_id);

    if (!audio) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Audio not found",
        instance: ctx.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    return ctx.json(audio);
  });

  // TODO: Implement signed audio file serving once R2Object API is clarified
  // For now, signed URLs will point to placeholder URLs until R2Object streaming is resolved
  /*
  // Serve signed audio files - no OpenAPI spec needed as this is internal
  app.get("/audio/signed/:token", async (ctx) => {
    const token = ctx.req.param("token");
    
    if (!token) {
      throw new HTTPException(400, { message: "Missing token" });
    }

    try {
      const secret = process.env.JWT_SECRET || 'your-secret-key';
      const decoded = jwt.verify(decodeURIComponent(token), secret) as any;
      
      if (decoded.purpose !== 'audio_access') {
        throw new HTTPException(403, { message: "Invalid token purpose" });
      }

      const r2Key = decoded.r2_key;
      
      // Get the file from R2 bucket
      const r2Object = await audioService.getR2Object(r2Key);
      
      if (!r2Object) {
        throw new HTTPException(404, { message: "Audio file not found" });
      }

      // Stream the file back to the client
      const headers = new Headers();
      headers.set('Content-Type', r2Object.httpMetadata?.contentType || 'audio/mpeg');
      headers.set('Content-Length', r2Object.size.toString());
      headers.set('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour
      
      // Get the file content as ArrayBuffer and create a Response
      const arrayBuffer = await r2Object.arrayBuffer();
      
      return new Response(arrayBuffer, {
        headers,
        status: 200
      });
      
    } catch (error: any) {
      if (error?.name === 'TokenExpiredError') {
        throw new HTTPException(410, { message: "Signed URL has expired" });
      }
      if (error?.name === 'JsonWebTokenError') {
        throw new HTTPException(403, { message: "Invalid token" });
      }
      console.error('Error serving signed audio:', error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  });
  */

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/audio/multipart/initiate
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/shows/{show_id}/episodes/{episode_id}/audio/multipart/initiate",
      tags: ["audio"],
      summary: "Initiate multipart audio upload",
      description: "Start a multipart upload session for large audio files",
      request: {
        params: AudioParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: InitiateMultipartUploadSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: MultipartUploadResponseSchema,
            },
          },
          description: "Multipart upload session initiated",
        },
      },
      security: [{ Bearer: ["podcast:write"] }],
    }),
    async (ctx) => {
      const { show_id, episode_id } = ctx.req.valid("param");
      const { fileName, fileSize, mimeType, totalChunks } =
        ctx.req.valid("json");

      const result = await audioService.initiateMultipartUpload(
        show_id,
        episode_id,
        fileName,
        fileSize,
        mimeType,
        totalChunks
      );

      return ctx.json({
        ...result,
        chunkSize: Math.ceil(fileSize / totalChunks),
      });
    }
  );

  // --------------------------------
  // PUT /shows/{show_id}/episodes/{episode_id}/audio/multipart/{upload_id}/chunk/{chunk_number}
  // --------------------------------
  app.openapi(
    createRoute({
      method: "put",
      path: "/shows/{show_id}/episodes/{episode_id}/audio/multipart/{upload_id}/chunk/{chunk_number}",
      tags: ["audio"],
      summary: "Upload audio chunk",
      description: "Upload a single chunk of the audio file",
      request: {
        params: ChunkParamsSchema,
        body: {
          content: {
            "application/octet-stream": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: ChunkUploadResponseSchema,
            },
          },
          description: "Chunk uploaded successfully",
        },
      },
      security: [{ Bearer: ["podcast:write"] }],
    }),
    async (ctx) => {
      const { upload_id, chunk_number } = ctx.req.valid("param");

      // Get the raw body as ArrayBuffer
      const chunkData = await ctx.req.arrayBuffer();

      const result = await audioService.uploadChunk(
        upload_id,
        chunk_number,
        chunkData
      );

      return ctx.json(result);
    }
  );

  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/audio/multipart/{upload_id}/complete
  // --------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/shows/{show_id}/episodes/{episode_id}/audio/multipart/complete",
      tags: ["audio"],
      summary: "Complete multipart audio upload",
      description: "Finalize the multipart upload and create the audio file",
      request: {
        params: AudioParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: CompleteMultipartUploadSchema,
            },
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: AudioUploadSchema,
            },
          },
          description: "Audio file created successfully",
        },
      },
      security: [{ Bearer: ["podcast:write"] }],
    }),
    async (ctx) => {
      const { show_id } = ctx.req.valid("param");
      const { uploadId } = ctx.req.valid("json");

      const result = await audioService.completeMultipartUpload(
        show_id,
        uploadId
      );

      return ctx.json(result, 201);
    }
  );

  return app;
}
