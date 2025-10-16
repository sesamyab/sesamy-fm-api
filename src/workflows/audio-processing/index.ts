import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";

// Import types
import type { Env, AudioProcessingParams } from "./types";
import { AudioProcessingParamsSchema } from "./types";

import { InitializeWorkflowStep } from "./initialize-workflow";
import { encodeAudioForTTS } from "./tts-encode";
import { WorkflowProgressReporter } from "./progress-reporter";
import { audioChunking } from "./audio-chunking";
// import { enhanceTranscript } from "./enhance-transcript";
// import { audioEncoding } from "./audio-encoding";
// import { updateEpisodeEncodings } from "./update-episode-encodings";
import { cleanupResources } from "./cleanup-resources";
// import { finalizeProcessing } from "./finalize-processing";

export class AudioProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  AudioProcessingParams
> {
  private readonly totalSteps = 4; // Updated: only encoding steps now

  private async updateWorkflowStatus(
    taskId?: string,
    status?: string,
    message?: string
  ): Promise<void> {
    if (!taskId) return;

    try {
      const taskIdNum = parseInt(taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${taskId}`);
        return;
      }

      const { TaskService } = await import("../../tasks/service.js");
      const taskService = new TaskService(this.env.DB);

      await taskService.updateTaskStatus(taskIdNum, status || "processing", {
        message,
      });
    } catch (error) {
      console.error("Error updating workflow status:", error);
    }
  }

  private async updateStepProgress(
    stepNumber: number,
    description: string,
    taskId?: string,
    data?: any
  ): Promise<void> {
    if (!taskId) return;

    const progress = Math.round((stepNumber / this.totalSteps) * 100);
    const stepMessage = `${stepNumber}/${this.totalSteps} ${description}`;

    try {
      const taskIdNum = parseInt(taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${taskId}`);
        return;
      }

      const { TaskService } = await import("../../tasks/service.js");
      const taskService = new TaskService(this.env.DB);

      // Update step and progress
      await taskService.updateTaskStep(taskIdNum, stepMessage, progress);

      // Update result if data is provided
      if (data) {
        await this.updateTaskResult(taskId, {
          step: stepNumber,
          description,
          progress,
          stepMessage,
          data,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Error updating step progress:", error);
    }
  }

  private async updateTaskResult(taskId: string, result: any): Promise<void> {
    try {
      const taskIdNum = parseInt(taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${taskId}`);
        return;
      }

      const { TaskRepository } = await import("../../tasks/repository.js");
      const taskRepository = new TaskRepository(this.env.DB);

      // Update the task result by storing it in the result field
      await taskRepository.updateStatus(taskIdNum, "processing", {
        result: JSON.stringify(result),
      });
    } catch (error) {
      console.error("Error updating task result:", error);
    }
  }

  private async handleWorkflowError(
    stepName: string,
    error: unknown,
    taskId?: string,
    workflowId?: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullErrorMessage = `Failed at step ${stepName}: ${errorMessage}`;
    console.error(`Workflow failed at step ${stepName}:`, errorMessage);

    try {
      // Use WorkflowService to properly fail both workflow and task
      if (workflowId) {
        const { WorkflowService } = await import("../service.js");
        const workflowService = new WorkflowService(this.env.DB);

        await workflowService.failWorkflow(
          workflowId,
          fullErrorMessage,
          undefined // actualDuration - could be calculated if needed
        );
      } else if (taskId) {
        // Fallback to direct task update if workflowId is not available
        await this.updateWorkflowStatus(taskId, "failed", fullErrorMessage);
      }

      // Also update task result with detailed error information
      if (taskId) {
        await this.updateTaskResult(taskId, {
          status: "failed",
          error: fullErrorMessage,
          step: stepName,
          timestamp: new Date().toISOString(),
          originalError: errorMessage,
        });
      }
    } catch (updateError) {
      console.error("Failed to update workflow failure status:", updateError);
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

    // Track current step for error handling
    let currentStep: string = "initialization";

    try {
      // Set status to in progress at the beginning
      try {
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

      // Step 1: Initialize workflow and validate inputs
      currentStep = "initialize-workflow";
      let workflowState = await step.do("initialize-workflow", async () => {
        await this.updateStepProgress(
          1,
          "Initializing workflow",
          validatedParams.taskId
        );
        await progressReporter.reportStepProgress(
          "initialize-workflow",
          0,
          "1/4 Initializing workflow"
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

      // Step 2: Encode audio to mp3
      currentStep = "encode";
      let encodedAudio = await step.do(
        "encode",
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
            "Encoding audio",
            validatedParams.taskId
          );
          await progressReporter.reportStepProgress(
            "encode-for-tts",
            0,
            "2/4 Encoding audio for TTS"
          );

          const result = await encodeAudioForTTS(this.env, workflowState);

          await progressReporter.reportStepComplete(
            "encode",
            "Encode audio for TTS"
          );

          // Return legacy format for backward compatibility
          const { signedUrls, ...legacyResult } = result;
          return legacyResult;
        }
      );

      // Step 3: Audio Chunking for Transcription (includes chunk storage preparation)
      currentStep = "audio-chunking";
      let chunkingResult = await step.do(
        "audio-chunking",
        {
          retries: {
            limit: 3,
            delay: "10 seconds",
            backoff: "exponential",
          },
          timeout: "12 minutes", // Increased timeout to account for storage preparation
        },
        async () => {
          await this.updateStepProgress(
            3,
            "Preparing storage and creating audio chunks",
            validatedParams.taskId
          );
          await progressReporter.reportStepProgress(
            "audio-chunking",
            0,
            "3/4 Preparing storage and creating audio chunks"
          );

          const result = await audioChunking(
            this.env,
            workflowState,
            encodedAudio
          );

          await progressReporter.reportStepComplete(
            "audio-chunking",
            `Created ${result.chunks.length} audio chunks`
          );

          return result;
        }
      );

      // Step 4: Cleanup temporary files from R2 (optional)
      currentStep = "cleanup-resources";
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
            4,
            "Cleaning up temporary files",
            validatedParams.taskId
          );
          return await cleanupResources(this.env, encodedAudio, chunkingResult);
        }
      );

      // Prepare final result
      const encodingResult = {
        success: true,
        episodeId: workflowState.episodeId,
        workflowId: workflowState.workflowId,
        completedAt: new Date().toISOString(),
        encoding: {
          audioUrl: encodedAudio.encodedAudioUrl,
          chunks: chunkingResult.chunks.length,
        },
      };

      // Mark workflow as completed
      currentStep = "workflow-completion";
      try {
        // Use WorkflowService to properly complete both workflow and task
        if (validatedParams.workflowId) {
          const { WorkflowService } = await import("../service.js");
          const workflowService = new WorkflowService(this.env.DB);

          await workflowService.completeWorkflow(
            validatedParams.workflowId,
            encodingResult,
            undefined // actualDuration - could be calculated if needed
          );

          console.log(
            `Audio encoding workflow completed successfully for episode ${validatedParams.episodeId}`
          );
        } else {
          // Fallback to direct task update if workflowId is not available
          await this.updateWorkflowStatus(
            validatedParams.taskId,
            "done",
            "Audio encoding completed successfully"
          );
          console.log(
            `Audio encoding workflow completed successfully for episode ${validatedParams.episodeId} (direct task update)`
          );
        }

        // Update task result with encoding details
        if (validatedParams.taskId) {
          await this.updateTaskResult(validatedParams.taskId, encodingResult);
        }
      } catch (error) {
        console.error("Failed to set final workflow status:", error);
        // Don't throw here as the workflow is actually completed
      }

      return encodingResult;
    } catch (error: any) {
      // Handle workflow error with current step information
      console.error(`Workflow failed at step: ${currentStep}`, error);

      await this.handleWorkflowError(
        currentStep,
        error,
        validatedParams.taskId,
        validatedParams.workflowId
      );

      // Re-throw the error to ensure the workflow fails
      throw error;
    }
  }
}

// Export all types
export * from "./types";

// Export new step classes
export { InitializeWorkflowStep } from "./initialize-workflow";
export { encodeAudioForTTS } from "./tts-encode";
export { WorkflowProgressReporter } from "./progress-reporter";

// Export utility functions
export { processEncodingFormats, mergeTranscriptions } from "./utils";
