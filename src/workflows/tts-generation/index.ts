import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import { R2PreSignedUrlGenerator } from "../../utils";

import type { Env, TtsGenerationParams, TtsGenerationResult } from "./types";
import { TtsGenerationParamsSchema } from "./types";

export class TtsGenerationWorkflow extends WorkflowEntrypoint<
  Env,
  TtsGenerationParams
> {
  async run(event: WorkflowEvent<TtsGenerationParams>, step: WorkflowStep) {
    // Validate input parameters
    const validatedParams = TtsGenerationParamsSchema.parse(event.payload);

    const { episodeId, scriptUrl, voice, model, taskId, organizationId } =
      validatedParams;

    // Step 1: Initialize workflow
    const workflowState = await step.do(
      "initialize",
      {
        retries: {
          limit: 0,
          delay: "1 second",
        },
        timeout: "30 seconds",
      },
      async () => {
        await this.updateTaskStatus(
          taskId,
          "processing",
          "Initializing TTS generation"
        );

        const workflowId = uuidv4();
        const timestamp = new Date().toISOString();

        return {
          workflowId,
          episodeId,
          scriptUrl,
          voice,
          model,
          taskId,
          organizationId,
          startedAt: timestamp,
        };
      }
    );

    // Step 2: Fetch script content
    const scriptContent = await step.do(
      "fetch-script",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "30 seconds",
      },
      async () => {
        await this.updateTaskProgress(taskId, 20, "Fetching script content");

        let text: string;

        // Handle R2 URLs by reading directly from R2 bucket
        if (scriptUrl.startsWith("r2://")) {
          // Strip r2:// prefix to get the actual R2 key
          const r2Key = scriptUrl.substring(5);

          // Read directly from R2 bucket (no HTTP roundtrip needed)
          const r2Object = await this.env.BUCKET.get(r2Key);

          if (!r2Object) {
            throw new Error(`Script not found in R2: ${r2Key}`);
          }

          text = await r2Object.text();
        } else {
          // For HTTP/HTTPS URLs, fetch normally
          const response = await fetch(scriptUrl);

          if (!response.ok) {
            throw new Error(
              `Failed to fetch script: ${response.status} ${response.statusText}`
            );
          }

          text = await response.text();
        }

        return {
          text,
          length: text.length,
        };
      }
    );

    // Step 3: Generate audio using Deepgram Aura TTS
    const ttsResult: TtsGenerationResult = await step.do(
      "generate-tts",
      {
        retries: {
          limit: 2,
          delay: "10 seconds",
        },
        timeout: "5 minutes",
      },
      async () => {
        await this.updateTaskProgress(
          taskId,
          50,
          "Generating audio with Deepgram Aura"
        );

        // Use Cloudflare AI to generate TTS audio
        const ttsResponse = await this.env.AI.run(model as any, {
          text: scriptContent.text,
          speaker: voice, // Use 'speaker' parameter as per Aura-1 API
          encoding: "mp3", // Specify encoding format (container not needed for mp3)
        });

        if (!ttsResponse) {
          throw new Error("AI.run returned null or undefined response");
        }

        // Convert the response to an ArrayBuffer
        let audioArrayBuffer: ArrayBuffer;

        if (ttsResponse instanceof ReadableStream) {
          // If it's a stream, read it into an ArrayBuffer
          const reader = ttsResponse.getReader();
          const chunks: Uint8Array[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
              }
            }
          } finally {
            reader.releaseLock();
          }

          if (chunks.length === 0) {
            throw new Error("No audio data received from TTS service");
          }

          // Combine all chunks into a single ArrayBuffer
          const totalLength = chunks.reduce(
            (acc, chunk) => acc + chunk.length,
            0
          );
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          audioArrayBuffer = combined.buffer;
        } else if (ttsResponse instanceof ArrayBuffer) {
          audioArrayBuffer = ttsResponse;
        } else if (ArrayBuffer.isView(ttsResponse)) {
          // Handle typed arrays (Uint8Array, etc.) - create a copy
          const uint8 = new Uint8Array(ttsResponse.byteLength);
          uint8.set(
            new Uint8Array(
              ttsResponse.buffer,
              ttsResponse.byteOffset,
              ttsResponse.byteLength
            )
          );
          audioArrayBuffer = uint8.buffer;
        } else {
          throw new Error(
            `Unexpected TTS response format: ${typeof ttsResponse}`
          );
        }

        if (audioArrayBuffer.byteLength === 0) {
          throw new Error("Generated audio file is empty");
        }

        // Generate R2 key for the audio file
        const audioFileId = uuidv4();
        const audioR2Key = `tts/${episodeId}/${audioFileId}.mp3`;

        // Upload audio to R2 bucket
        await this.env.BUCKET.put(audioR2Key, audioArrayBuffer, {
          httpMetadata: {
            contentType: "audio/mpeg",
          },
        });

        // Generate R2 presigned URL generator for creating signed URLs
        const r2Generator = new R2PreSignedUrlGenerator(
          this.env.R2_ACCESS_KEY_ID,
          this.env.R2_SECRET_ACCESS_KEY,
          this.env.R2_ENDPOINT
        );

        // Generate a presigned URL for the audio file
        const audioUrl = await r2Generator.generatePresignedUrl(
          "podcast-service-assets",
          audioR2Key,
          3600, // 1 hour expiration
          "GET"
        );

        return {
          audioR2Key: `r2://${audioR2Key}`,
          audioUrl,
          textLength: scriptContent.length,
          estimatedDuration: Math.ceil(scriptContent.length / 10), // Rough estimate: ~10 chars/second
        };
      }
    );

    // Step 4: Update episode with audio URL
    await step.do(
      "update-episode",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "30 seconds",
      },
      async () => {
        await this.updateTaskProgress(
          taskId,
          80,
          "Updating episode with TTS audio"
        );

        // Update the episode in the database
        const updateQuery = `
          UPDATE episodes
          SET audio_url = ?, updated_at = ?
          WHERE id = ?
        `;

        await this.env.DB.prepare(updateQuery)
          .bind(ttsResult.audioR2Key, new Date().toISOString(), episodeId)
          .run();

        return true;
      }
    );

    // Step 5: Complete workflow
    await step.do(
      "complete",
      {
        retries: {
          limit: 0,
          delay: "1 second",
        },
        timeout: "30 seconds",
      },
      async () => {
        // Update task progress to 100%
        await this.updateTaskProgress(taskId, 100, "TTS generation completed");

        // Update task status to done
        await this.updateTaskStatus(
          taskId,
          "done",
          "TTS generation completed successfully"
        );

        // Update task result
        if (taskId) {
          const resultQuery = `
            UPDATE tasks
            SET result = ?, updated_at = ?
            WHERE id = ?
          `;

          const resultUpdate = await this.env.DB.prepare(resultQuery)
            .bind(
              JSON.stringify({
                audioR2Key: ttsResult.audioR2Key,
                audioUrl: ttsResult.audioUrl,
                textLength: ttsResult.textLength,
                estimatedDuration: ttsResult.estimatedDuration,
              }),
              new Date().toISOString(),
              parseInt(taskId)
            )
            .run();

          console.log(`Updated task ${taskId} result:`, resultUpdate.meta);
        }

        return {
          success: true,
          episodeId,
          ...ttsResult,
        };
      }
    );

    return {
      success: true,
      episodeId,
      ...ttsResult,
    };
  }

  // Helper method to update task progress
  private async updateTaskProgress(
    taskId: string | undefined,
    progress: number,
    message?: string
  ): Promise<void> {
    if (!taskId) return;

    try {
      const query = `
        UPDATE tasks
        SET progress = ?, step = ?, updated_at = ?
        WHERE id = ?
      `;

      const result = await this.env.DB.prepare(query)
        .bind(
          progress,
          message || null,
          new Date().toISOString(),
          parseInt(taskId)
        )
        .run();
    } catch (error) {
      console.error(`Failed to update task ${taskId} progress:`, error);
      // Don't throw - allow workflow to continue
    }
  }

  // Helper method to update task status
  private async updateTaskStatus(
    taskId: string | undefined,
    status: string,
    message?: string
  ): Promise<void> {
    if (!taskId) return;

    try {
      const query = `
        UPDATE tasks
        SET status = ?, step = ?, updated_at = ?
        WHERE id = ?
      `;

      const result = await this.env.DB.prepare(query)
        .bind(
          status,
          message || null,
          new Date().toISOString(),
          parseInt(taskId)
        )
        .run();

      console.log(`Updated task ${taskId} status to ${status}:`, result.meta);
    } catch (error) {
      console.error(`Failed to update task ${taskId} status:`, error);
      // Don't throw - allow workflow to continue
    }
  }
}

// Export types
export * from "./types";
