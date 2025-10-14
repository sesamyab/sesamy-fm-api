import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import { generateSignedUploadUrl } from "../../utils/storage";
import { R2PreSignedUrlGenerator } from "../../utils";

import type { Env, TtsGenerationParams, TtsGenerationResult } from "./types";
import { TtsGenerationParamsSchema } from "./types";

export class TtsGenerationWorkflow extends WorkflowEntrypoint<
  Env,
  TtsGenerationParams
> {
  async run(
    event: WorkflowEvent<TtsGenerationParams>,
    step: WorkflowStep
  ) {
    // Validate input parameters
    const validatedParams = TtsGenerationParamsSchema.parse(event.payload);

    const { episodeId, scriptUrl, voice, model, taskId, organizationId } =
      validatedParams;

    console.log(
      `Starting TTS generation workflow for episode ${episodeId} with script URL: ${scriptUrl}`
    );

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
        await this.updateTaskStatus(taskId, "processing", "Initializing TTS generation");

        const workflowId = uuidv4();
        const timestamp = new Date().toISOString();

        console.log(
          `TTS workflow initialized: ${workflowId} for episode ${episodeId}`
        );

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

        console.log(`Fetching script from URL: ${scriptUrl}`);
        const response = await fetch(scriptUrl);
        
        if (!response.ok) {
          throw new Error(
            `Failed to fetch script: ${response.status} ${response.statusText}`
          );
        }

        const text = await response.text();
        console.log(`Script fetched successfully, length: ${text.length} characters`);

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
        await this.updateTaskProgress(taskId, 50, "Generating audio with Deepgram Aura");

        console.log(
          `Generating TTS audio with model ${model}, voice ${voice}, text length: ${scriptContent.length}`
        );

        // Use Cloudflare AI to generate TTS audio
        const ttsResponse = await this.env.AI.run(model as any, {
          text: scriptContent.text,
          voice: voice,
        });

        // Convert the response to an ArrayBuffer
        let audioArrayBuffer: ArrayBuffer;
        
        if (ttsResponse instanceof ReadableStream) {
          // If it's a stream, read it into an ArrayBuffer
          const reader = ttsResponse.getReader();
          const chunks: Uint8Array[] = [];
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          
          // Combine all chunks into a single ArrayBuffer
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          audioArrayBuffer = combined.buffer;
        } else if (ttsResponse instanceof ArrayBuffer) {
          audioArrayBuffer = ttsResponse;
        } else {
          throw new Error("Unexpected TTS response format");
        }

        console.log(`TTS audio generated, size: ${audioArrayBuffer.byteLength} bytes`);

        // Generate R2 key for the audio file
        const audioFileId = uuidv4();
        const audioR2Key = `tts/${episodeId}/${audioFileId}.mp3`;

        // Upload audio to R2 bucket
        await this.env.PODCAST_SERVICE_ASSETS.put(audioR2Key, audioArrayBuffer, {
          httpMetadata: {
            contentType: "audio/mpeg",
          },
        });

        console.log(`TTS audio uploaded to R2: ${audioR2Key}`);

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
          3600 // 1 hour expiration
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
        await this.updateTaskProgress(taskId, 80, "Updating episode with TTS audio");

        console.log(`Updating episode ${episodeId} with audio URL: ${ttsResult.audioR2Key}`);

        // Update the episode in the database
        const updateQuery = `
          UPDATE episodes
          SET audio_url = ?, updated_at = ?
          WHERE id = ?
        `;

        await this.env.DATABASE.prepare(updateQuery)
          .bind(ttsResult.audioR2Key, new Date().toISOString(), episodeId)
          .run();

        console.log(`Episode ${episodeId} updated successfully`);

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
        await this.updateTaskStatus(taskId, "completed", "TTS generation completed successfully");

        // Update task result
        if (taskId) {
          const resultQuery = `
            UPDATE tasks
            SET result = ?, updated_at = ?
            WHERE id = ?
          `;

          await this.env.DATABASE.prepare(resultQuery)
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
        }

        console.log(`TTS generation workflow completed for episode ${episodeId}`);

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

      await this.env.DATABASE.prepare(query)
        .bind(progress, message || null, new Date().toISOString(), parseInt(taskId))
        .run();
    } catch (error) {
      console.error("Failed to update task progress:", error);
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

      await this.env.DATABASE.prepare(query)
        .bind(status, message || null, new Date().toISOString(), parseInt(taskId))
        .run();
    } catch (error) {
      console.error("Failed to update task status:", error);
    }
  }
}

// Export types
export * from "./types";
