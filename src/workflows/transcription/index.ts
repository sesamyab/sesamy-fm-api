import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import { R2PreSignedUrlGenerator } from "../../utils";

import type { Env, TranscriptionParams, TranscriptionResult } from "./types";
import { TranscriptionParamsSchema } from "./types";

export class TranscriptionWorkflow extends WorkflowEntrypoint<
  Env,
  TranscriptionParams
> {
  async run(event: WorkflowEvent<TranscriptionParams>, step: WorkflowStep) {
    // Validate input parameters
    const validatedParams = TranscriptionParamsSchema.parse(event.payload);

    const {
      episodeId,
      audioUrl,
      audioR2Key,
      taskId,
      organizationId,
      language,
      model,
    } = validatedParams;

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
          "Initializing transcription"
        );

        const workflowId = uuidv4();
        const timestamp = new Date().toISOString();

        return {
          workflowId,
          episodeId,
          audioUrl,
          audioR2Key,
          taskId,
          organizationId,
          language,
          model,
          startedAt: timestamp,
        };
      }
    );

    // Step 2: Fetch audio file
    const audioData = await step.do(
      "fetch-audio",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "2 minutes",
      },
      async () => {
        await this.updateTaskProgress(taskId, 20, "Fetching audio file");

        let audioBlob: Blob;

        // Handle R2 URLs by reading directly from R2 bucket
        if (audioR2Key) {
          // Strip r2:// prefix if present
          const r2Key = audioR2Key.startsWith("r2://")
            ? audioR2Key.substring(5)
            : audioR2Key;

          const r2Object = await this.env.BUCKET.get(r2Key);

          if (!r2Object) {
            throw new Error(`Audio not found in R2: ${r2Key}`);
          }

          audioBlob = await r2Object.blob();
        } else {
          // For HTTP/HTTPS URLs, fetch normally
          const response = await fetch(audioUrl);

          if (!response.ok) {
            throw new Error(
              `Failed to fetch audio: ${response.status} ${response.statusText}`
            );
          }

          audioBlob = await response.blob();
        }

        return {
          blob: audioBlob,
          size: audioBlob.size,
        };
      }
    );

    // Step 3: Transcribe audio using Cloudflare AI
    const transcriptionResult = await step.do(
      "transcribe-audio",
      {
        retries: {
          limit: 2,
          delay: "10 seconds",
        },
        timeout: "10 minutes",
      },
      async () => {
        await this.updateTaskProgress(
          taskId,
          50,
          "Transcribing audio with Whisper"
        );

        // Use Cloudflare AI to transcribe audio
        const transcription = await this.env.AI.run(model as any, {
          audio: audioData.blob,
          source_lang: language,
        });

        if (!transcription || !transcription.text) {
          throw new Error("Transcription failed or returned empty result");
        }

        const transcript = transcription.text.trim();
        const wordCount = transcript.split(/\s+/).length;

        // Generate R2 key for the transcript file
        const transcriptFileId = uuidv4();
        const transcriptR2Key = `transcripts/${episodeId}/${transcriptFileId}.txt`;

        // Upload transcript to R2 bucket
        await this.env.BUCKET.put(transcriptR2Key, transcript, {
          httpMetadata: {
            contentType: "text/plain; charset=utf-8",
          },
        });

        // Generate R2 presigned URL for the transcript
        const r2Generator = new R2PreSignedUrlGenerator(
          this.env.R2_ACCESS_KEY_ID,
          this.env.R2_SECRET_ACCESS_KEY,
          this.env.R2_ENDPOINT
        );

        const transcriptUrl = await r2Generator.generatePresignedUrl(
          "podcast-service-assets",
          transcriptR2Key,
          3600, // 1 hour expiration
          "GET"
        );

        return {
          transcriptR2Key: `r2://${transcriptR2Key}`,
          transcriptUrl,
          transcript,
          wordCount,
        };
      }
    );

    // Step 4: Update episode with transcript
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
          "Updating episode with transcript"
        );

        // Update the episode in the database
        const updateQuery = `
          UPDATE episodes
          SET transcript_url = ?, updated_at = ?
          WHERE id = ?
        `;

        await this.env.DB.prepare(updateQuery)
          .bind(
            transcriptionResult.transcriptR2Key,
            new Date().toISOString(),
            episodeId
          )
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
        await this.updateTaskProgress(taskId, 100, "Transcription completed");

        // Update task status to done
        await this.updateTaskStatus(
          taskId,
          "done",
          "Transcription completed successfully"
        );

        // Update task result
        if (taskId) {
          const resultQuery = `
            UPDATE tasks
            SET result = ?, updated_at = ?
            WHERE id = ?
          `;

          await this.env.DB.prepare(resultQuery)
            .bind(
              JSON.stringify({
                transcriptR2Key: transcriptionResult.transcriptR2Key,
                transcriptUrl: transcriptionResult.transcriptUrl,
                wordCount: transcriptionResult.wordCount,
              }),
              new Date().toISOString(),
              parseInt(taskId)
            )
            .run();

          console.log(`Updated task ${taskId} result with transcription data`);
        }

        return {
          success: true,
          episodeId,
          ...transcriptionResult,
        };
      }
    );

    return {
      success: true,
      episodeId,
      ...transcriptionResult,
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

      await this.env.DB.prepare(query)
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

      await this.env.DB.prepare(query)
        .bind(
          status,
          message || null,
          new Date().toISOString(),
          parseInt(taskId)
        )
        .run();

      console.log(`Updated task ${taskId} status to ${status}`);
    } catch (error) {
      console.error(`Failed to update task ${taskId} status:`, error);
      // Don't throw - allow workflow to continue
    }
  }
}

// Export types
export * from "./types";
