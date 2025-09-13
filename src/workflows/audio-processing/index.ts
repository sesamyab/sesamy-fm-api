import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";

// Import types
import type { Env, AudioProcessingParams } from "./types";
import { AudioProcessingParamsSchema } from "./types";

// Import new step classes
import { InitializeWorkflowStep } from "./initialize-workflow";
import { EncodeForProcessingStep } from "./encode-for-processing";
import { PrepareChunkStorageStep } from "./prepare-chunk-storage";
import { WorkflowProgressReporter } from "./progress-reporter";

// Import legacy functions for backward compatibility
import { audioChunking } from "./audio-chunking";
import { transcribeChunks } from "./transcribe-chunks";
import { audioEncoding } from "./audio-encoding";
import { updateEpisodeEncodings } from "./update-episode-encodings";
import { cleanupResources } from "./cleanup-resources";
import { finalizeProcessing } from "./finalize-processing";

export class AudioProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  AudioProcessingParams
> {
  private readonly totalSteps = 9;

  private async updateWorkflowStatus(
    taskId?: string,
    status?: string,
    message?: string
  ): Promise<void> {
    if (!taskId) return;

    try {
      const baseUrl = this.env.SERVICE_BASE_URL;
      if (!baseUrl) {
        console.warn("SERVICE_BASE_URL not configured, skipping status update");
        return;
      }

      const response = await fetch(
        `${baseUrl}/internal/tasks/${taskId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status, message }),
        }
      );

      if (!response.ok) {
        console.error(`Failed to update task status: ${response.status}`);
      }
    } catch (error) {
      console.error("Error updating workflow status:", error);
    }
  }

  private async updateStepProgress(
    stepNumber: number,
    description: string,
    taskId?: string
  ): Promise<void> {
    if (!taskId) return;

    const progress = Math.round((stepNumber / this.totalSteps) * 100);
    const message = `${stepNumber}/${this.totalSteps} ${description}`;

    try {
      const baseUrl = this.env.SERVICE_BASE_URL;
      if (!baseUrl) {
        console.warn(
          "SERVICE_BASE_URL not configured, skipping progress update"
        );
        return;
      }

      const response = await fetch(
        `${baseUrl}/internal/tasks/${taskId}/progress`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ progress, message }),
        }
      );

      if (!response.ok) {
        console.error(`Failed to update task progress: ${response.status}`);
      }
    } catch (error) {
      console.error("Error updating step progress:", error);
    }
  }

  private async handleWorkflowError(
    stepName: string,
    error: unknown,
    taskId?: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Workflow failed at step ${stepName}:`, errorMessage);

    if (taskId) {
      await this.updateWorkflowStatus(
        taskId,
        "failed",
        `Failed at step ${stepName}: ${errorMessage}`
      );
    }
  }

  async run(event: WorkflowEvent<AudioProcessingParams>, step: WorkflowStep) {
    let validatedParams: AudioProcessingParams;

    try {
      // Validate input parameters using Zod
      validatedParams = AudioProcessingParamsSchema.parse(event.payload);
    } catch (error) {
      console.error("Invalid workflow parameters:", error);
      throw new Error(
        `Invalid workflow parameters: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Create progress reporter
    const progressReporter = new WorkflowProgressReporter(
      this.env,
      validatedParams.taskId,
      event.payload.workflowId // This would be passed by the task service
    );

    try {
      // Set status to in progress at the beginning
      await this.updateWorkflowStatus(
        validatedParams.taskId,
        "processing",
        "Workflow started"
      );

      console.log(
        `Starting audio processing workflow for episode ${validatedParams.episodeId}`
      );
    } catch (error) {
      console.error("Failed to set initial workflow status:", error);
      // Continue with workflow even if status update fails
    }

    try {
      // Step 1: Initialize workflow and validate inputs
      let workflowState;
      try {
        workflowState = await step.do("initialize-workflow", async () => {
          await this.updateStepProgress(
            1,
            "Initializing workflow",
            validatedParams.taskId
          );
          await progressReporter.reportStepProgress(
            "initialize-workflow",
            0,
            "1/9 Initializing workflow"
          );

          const initStep = new InitializeWorkflowStep(this.env);
          const result = await initStep.execute(validatedParams);

          await progressReporter.reportStepComplete(
            "initialize-workflow",
            "Workflow initialized successfully"
          );

          // Return legacy format for backward compatibility
          const { signedUrls, ...legacyResult } = result;
          return legacyResult;
        });
      } catch (error) {
        await this.handleWorkflowError(
          "initialize-workflow",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 2: Encode audio to 48 kbps Opus mono for efficient processing
      let encodedAudio;
      try {
        encodedAudio = await step.do(
          "encode-for-processing",
          {
            retries: {
              limit: 2,
              delay: "5 seconds",
            },
            timeout: "10 minutes",
          },
          async () => {
            await this.updateStepProgress(
              2,
              "Encoding audio for processing",
              validatedParams.taskId
            );
            await progressReporter.reportStepProgress(
              "encode-for-processing",
              0,
              "2/9 Encoding audio for processing"
            );

            const encodeStep = new EncodeForProcessingStep(this.env);
            const result = await encodeStep.execute(workflowState);

            await progressReporter.reportStepComplete(
              "encode-for-processing",
              "Audio encoded for processing"
            );

            // Return legacy format for backward compatibility
            const { signedUrls, ...legacyResult } = result;
            return legacyResult;
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "encode-for-processing",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 3: Prepare R2 storage for chunks using encoded audio duration
      let audioMetadata;
      try {
        audioMetadata = await step.do(
          "prepare-chunk-storage",
          {
            retries: {
              limit: 2,
              delay: "5 seconds",
            },
            timeout: "2 minutes",
          },
          async () => {
            await this.updateStepProgress(
              3,
              "Preparing chunk storage",
              validatedParams.taskId
            );
            await progressReporter.reportStepProgress(
              "prepare-chunk-storage",
              0,
              "3/9 Preparing chunk storage"
            );

            const prepareStep = new PrepareChunkStorageStep(this.env);
            const result = await prepareStep.execute({
              workflowState,
              encodedAudio,
            });

            await progressReporter.reportStepComplete(
              "prepare-chunk-storage",
              "Chunk storage prepared"
            );

            // Return legacy format for backward compatibility
            const { signedUrls, ...legacyResult } = result;
            return legacyResult;
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "prepare-chunk-storage",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 4: Audio Chunking for Transcription using encoded file
      let chunkingResult;
      try {
        chunkingResult = await step.do(
          "audio-chunking",
          {
            retries: {
              limit: 3,
              delay: "10 seconds",
              backoff: "exponential",
            },
            timeout: "10 minutes",
          },
          async () => {
            await this.updateStepProgress(
              4,
              "Creating audio chunks",
              validatedParams.taskId
            );
            await progressReporter.reportStepProgress(
              "audio-chunking",
              0,
              "4/9 Creating audio chunks"
            );

            const result = await audioChunking(
              this.env,
              workflowState,
              audioMetadata
            );

            await progressReporter.reportStepComplete(
              "audio-chunking",
              `Created ${result.chunks.length} audio chunks`
            );

            return result;
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "audio-chunking",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 5: Transcribe chunks in parallel
      let transcribedChunks;
      try {
        transcribedChunks = await step.do(
          "transcribe-chunks",
          {
            retries: {
              limit: 2,
              delay: "10 seconds",
              backoff: "exponential",
            },
            timeout: "20 minutes",
          },
          async () => {
            await this.updateStepProgress(
              5,
              "Transcribing audio chunks",
              validatedParams.taskId
            );
            await progressReporter.reportStepProgress(
              "transcribe-chunks",
              0,
              "5/9 Transcribing audio chunks"
            );

            const result = await transcribeChunks(
              this.env,
              workflowState,
              chunkingResult
            );

            await progressReporter.reportStepComplete(
              "transcribe-chunks",
              "Transcription completed"
            );

            return result;
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "transcribe-chunks",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 6: Audio Encoding (CPU-intensive operation)
      let encodingResult;
      try {
        encodingResult = await step.do(
          "audio-encoding",
          {
            retries: {
              limit: 3,
              delay: "10 seconds",
              backoff: "exponential",
            },
            timeout: "15 minutes",
          },
          async () => {
            await this.updateStepProgress(
              6,
              "Encoding audio formats",
              validatedParams.taskId
            );
            await progressReporter.reportStepProgress(
              "audio-encoding",
              0,
              "6/9 Encoding audio formats"
            );

            const result = await audioEncoding(this.env, workflowState);

            await progressReporter.reportStepComplete(
              "audio-encoding",
              `Encoded ${result.encodings.length} formats`
            );

            return result;
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "audio-encoding",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 7: Update episode with encoded audio URLs
      try {
        await step.do(
          "update-episode-encodings",
          {
            retries: {
              limit: 2,
              delay: "5 seconds",
            },
            timeout: "5 minutes",
          },
          async () => {
            await this.updateStepProgress(
              7,
              "Updating episode with encodings",
              validatedParams.taskId
            );
            return await updateEpisodeEncodings(
              this.env,
              workflowState,
              encodingResult.encodings
            );
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "update-episode-encodings",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 8: Cleanup temporary files from R2 (optional)
      try {
        await step.do(
          "cleanup-resources",
          {
            retries: {
              limit: 1,
              delay: "2 seconds",
            },
            timeout: "1 minute",
          },
          async () => {
            await this.updateStepProgress(
              8,
              "Cleaning up temporary files",
              validatedParams.taskId
            );
            return await cleanupResources(
              this.env,
              encodedAudio,
              chunkingResult
            );
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "cleanup-resources",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Step 9: Final processing and store transcript
      let finalResult;
      try {
        finalResult = await step.do(
          "finalize-processing",
          {
            retries: {
              limit: 2,
              delay: "2 seconds",
            },
            timeout: "5 minutes",
          },
          async () => {
            await this.updateStepProgress(
              9,
              "Finalizing processing and storing results",
              validatedParams.taskId
            );
            return await finalizeProcessing(
              this.env,
              workflowState,
              transcribedChunks,
              encodingResult.encodings
            );
          }
        );
      } catch (error) {
        await this.handleWorkflowError(
          "finalize-processing",
          error,
          validatedParams.taskId
        );
        throw error;
      }

      // Mark workflow as completed
      try {
        await this.updateWorkflowStatus(
          validatedParams.taskId,
          "done",
          "Workflow completed successfully"
        );
        console.log(
          `Audio processing workflow completed successfully for episode ${validatedParams.episodeId}`
        );
      } catch (error) {
        console.error("Failed to set final workflow status:", error);
        // Don't throw here as the workflow is actually completed
      }

      return {
        success: true,
        episodeId: workflowState.episodeId,
        workflowId: workflowState.workflowId,
        ...finalResult,
      };
    } catch (error) {
      // Handle any unexpected errors that weren't caught by individual steps
      await this.handleWorkflowError("workflow", error, validatedParams.taskId);
      console.error("Unexpected workflow error:", error);

      // Re-throw the error to ensure the workflow fails
      throw error;
    }
  }
}

// Export all types
export * from "./types";

// Export new step classes
export { InitializeWorkflowStep } from "./initialize-workflow";
export { EncodeForProcessingStep } from "./encode-for-processing";
export { PrepareChunkStorageStep } from "./prepare-chunk-storage";
export { WorkflowProgressReporter } from "./progress-reporter";

// Export legacy step functions for backward compatibility
export { initializeWorkflow } from "./initialize-workflow";
export { encodeForProcessing } from "./encode-for-processing";
export { prepareChunkStorage } from "./prepare-chunk-storage";
export { audioChunking } from "./audio-chunking";
export { transcribeChunks } from "./transcribe-chunks";
export { audioEncoding } from "./audio-encoding";
export { updateEpisodeEncodings } from "./update-episode-encodings";
export { cleanupResources } from "./cleanup-resources";
export { finalizeProcessing } from "./finalize-processing";

// Export utility functions
export { processEncodingFormats, mergeTranscriptions } from "./utils";
