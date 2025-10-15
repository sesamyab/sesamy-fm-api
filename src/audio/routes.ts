import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { AudioUploadSchema, AudioParamsSchema } from "./schemas";
import { AudioService } from "./service";
import { hasPermissions, hasScopes } from "../auth/middleware";
import { JWTPayload } from "../auth/types";
import { NotFoundError } from "../common/errors";

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
  security: [{ Bearer: [] }],
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
  security: [{ Bearer: [] }],
});

export function registerAudioRoutes(
  app: OpenAPIHono,
  audioService: AudioService
) {
  // --------------------------------
  // POST /shows/{show_id}/episodes/{episode_id}/audio
  // --------------------------------
  app.openapi(uploadAudioRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");

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

        // Convert File to Buffer
        const buffer = Buffer.from(await audioFile.arrayBuffer());

        // Store the markdown file in R2
        const scriptId = (await import("uuid")).v4();
        const scriptKey = `scripts/${show_id}/${episode_id}/${scriptId}/${audioFile.name}`;

        // Upload to R2
        if (audioService["bucket"]) {
          await audioService["bucket"].put(scriptKey, buffer, {
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
          const corsUrl = await audioService.generatePresignedUrlWithCors(scriptKey);
          if (corsUrl) {
            accessibleScriptUrl = corsUrl;
          }

          // Create TTS generation task
          try {
            const { TaskService } = await import("../tasks/service.js");
            const database = audioService["database"];
            const organizationId = payload.org_id;

            // Get TTS workflow binding from context if available
            const ttsWorkflow = (c.env as any)?.TTS_GENERATION_WORKFLOW;

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
          return c.json(
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
        // Convert File to Buffer
        const buffer = Buffer.from(await audioFile.arrayBuffer());

        const fileData = {
          fileName: audioFile.name,
          fileSize: audioFile.size,
          mimeType: audioFile.type,
          buffer,
        };

        const upload = await audioService.uploadAudio(
          show_id,
          episode_id,
          fileData
        );
        return c.json(upload, 201);
      }
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

      // Log the actual error for debugging
      console.error("Audio upload error:", error);

      // Re-throw to let the global error handler deal with it
      throw error;
    }
  });

  // --------------------------------
  // GET /shows/{show_id}/episodes/{episode_id}/audio
  // --------------------------------
  app.openapi(getAudioRoute, async (c) => {
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

    const { show_id, episode_id } = c.req.valid("param");
    const audio = await audioService.getAudioMetadata(show_id, episode_id);

    if (!audio) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Audio not found",
        instance: c.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    return c.json(audio);
  });

  // TODO: Implement signed audio file serving once R2Object API is clarified
  // For now, signed URLs will point to placeholder URLs until R2Object streaming is resolved
  /*
  // Serve signed audio files - no OpenAPI spec needed as this is internal
  app.get("/audio/signed/:token", async (c) => {
    const token = c.req.param("token");
    
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
}
