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
import { WorkflowProgressReporter } from "./progress-reporter";

// Import legacy functions for backward compatibility
import { audioChunking } from "./audio-chunking";
import { transcribeChunks } from "./transcribe-chunks";
import { enhanceTranscript } from "./enhance-transcript";
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
    const message = `${stepNumber}/${this.totalSteps} ${description}`;

    try {
      const taskIdNum = parseInt(taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${taskId}`);
        return;
      }

      const { TaskService } = await import("../../tasks/service.js");
      const taskService = new TaskService(this.env.DB);

      // Update progress
      await taskService.updateTaskProgress(taskIdNum, progress, message);

      // Update result if data is provided
      if (data) {
        await this.updateTaskResult(taskId, {
          step: stepNumber,
          description,
          progress,
          message,
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
          "1/10 Initializing workflow"
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

      // Step 2: Encode audio to 24 kbps Opus mono for efficient processing
      currentStep = "encode-for-processing";
      let encodedAudio = await step.do(
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
            "2/10 Encoding audio for processing"
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
            "3/9 Preparing storage and creating audio chunks"
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

      // Step 4: Transcribe chunks in parallel
      currentStep = "transcribe-chunks";
      const transcriptionResult = await step.do(
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
            4,
            "Transcribing audio chunks",
            validatedParams.taskId
          );
          await progressReporter.reportStepProgress(
            "transcribe-chunks",
            0,
            "4/9 Transcribing audio chunks"
          );

          const result = await transcribeChunks(
            this.env,
            workflowState,
            chunkingResult
          );

          await progressReporter.reportStepComplete(
            "transcribe-chunks",
            `Transcription completed (${result.transcribedChunks.length} chunks)`,
            {
              chunkTranscriptionsUrl: result.chunkTranscriptionsUrl,
            }
          );

          return result;
        }
      );

      // Extract the results from Step 5
      let transcribedChunks = transcriptionResult.transcribedChunks;
      let chunkTranscriptionsUrl = transcriptionResult.chunkTranscriptionsUrl;

      // Step 5: Enhance transcript with AI (create paragraphs, keywords, and chapters)
      currentStep = "enhance-transcript";
      let enhancedTranscriptResult = await step.do(
        "enhance-transcript",
        {
          retries: {
            limit: 2,
            delay: "10 seconds",
            backoff: "exponential",
          },
          timeout: "10 minutes",
        },
        async () => {
          await this.updateStepProgress(
            5,
            "Enhancing transcript with AI",
            validatedParams.taskId
          );
          await progressReporter.reportStepProgress(
            "enhance-transcript",
            0,
            "5/9 Enhancing transcript with AI"
          );

          const result = await enhanceTranscript(
            this.env,
            workflowState,
            transcribedChunks
          );

          await progressReporter.reportStepComplete(
            "enhance-transcript",
            `Enhanced transcript with ${result.chapters.length} chapters and ${result.keywords.length} keywords`,
            {
              transcriptUrl: result.enhancedTranscriptUrl,
              chapters: result.chapters.length,
              keywords: result.keywords.length,
              summary: result.summary ? "generated" : "none",
              chunkTranscriptionsUrl: chunkTranscriptionsUrl,
            }
          );

          // Update task result with enhanced transcript details
          await this.updateTaskResult(validatedParams.taskId!, {
            enhancedTranscript: {
              url: result.enhancedTranscriptUrl,
              chapters: result.chapters.length,
              keywords: result.keywords.length,
              paragraphs: result.paragraphs,
              hasSummary: !!result.summary,
            },
            chunkTranscriptions: chunkTranscriptionsUrl
              ? {
                  url: chunkTranscriptionsUrl,
                  description:
                    "Individual chunk transcriptions with timestamps",
                }
              : undefined,
          });

          return result;
        }
      );

      // Step 6: Audio Encoding (CPU-intensive operation)
      currentStep = "audio-encoding";
      let encodingResult = await step.do(
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

      // Step 7: Update episode with encoded audio URLs
      currentStep = "update-episode-encodings";
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

      // Step 8: Cleanup temporary files from R2 (optional)
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
            8,
            "Cleaning up temporary files",
            validatedParams.taskId
          );
          return await cleanupResources(this.env, encodedAudio, chunkingResult);
        }
      );

      // Step 9: Final processing and store transcript
      currentStep = "finalize-processing";
      let finalResult = await step.do(
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
          const finalResult = await finalizeProcessing(
            this.env,
            workflowState,
            transcribedChunks,
            encodingResult.encodings
          );

          // Update task result with final processing details
          await this.updateTaskResult(validatedParams.taskId!, {
            finalProcessing: {
              transcriptUrl: finalResult.transcriptUrl,
              textLength: finalResult.textLength,
              totalWords: finalResult.totalWords,
              totalChunks: finalResult.totalChunks,
              totalEncodings: finalResult.totalEncodings,
            },
          });

          return finalResult;
        }
      );

      // Update final comprehensive task result
      const comprehensiveResult = {
        success: true,
        episodeId: workflowState.episodeId,
        workflowId: workflowState.workflowId,
        completedAt: new Date().toISOString(),
        enhancedTranscript: enhancedTranscriptResult
          ? {
              url: enhancedTranscriptResult.enhancedTranscriptUrl,
              chapters: enhancedTranscriptResult.chapters.length,
              keywords: enhancedTranscriptResult.keywords.length,
              paragraphs: enhancedTranscriptResult.paragraphs,
              hasSummary: !!enhancedTranscriptResult.summary,
            }
          : undefined,
        chunkTranscriptions: chunkTranscriptionsUrl
          ? {
              url: chunkTranscriptionsUrl,
              description: "Individual chunk transcriptions with timestamps",
            }
          : undefined,
        encoding: {
          formats: encodingResult.encodings.length,
        },
        processing: {
          totalWords: finalResult.totalWords,
          totalChunks: finalResult.totalChunks,
          textLength: finalResult.textLength,
        },
        ...finalResult,
      };

      currentStep = "final-task-update";
      try {
        await this.updateTaskResult(
          validatedParams.taskId!,
          comprehensiveResult
        );
      } catch (error) {
        console.error("Failed to update final task result:", error);
      }

      // Mark workflow as completed
      currentStep = "workflow-completion";
      try {
        // Use WorkflowService to properly complete both workflow and task
        if (validatedParams.workflowId) {
          const { WorkflowService } = await import("../service.js");
          const workflowService = new WorkflowService(this.env.DB);

          await workflowService.completeWorkflow(
            validatedParams.workflowId,
            comprehensiveResult,
            undefined // actualDuration - could be calculated if needed
          );

          console.log(
            `Audio processing workflow and task completed successfully for episode ${validatedParams.episodeId}`
          );
        } else {
          // Fallback to direct task update if workflowId is not available
          await this.updateWorkflowStatus(
            validatedParams.taskId,
            "done",
            "Workflow completed successfully"
          );
          console.log(
            `Audio processing workflow completed successfully for episode ${validatedParams.episodeId} (direct task update)`
          );
        }
      } catch (error) {
        console.error("Failed to set final workflow status:", error);
        // Don't throw here as the workflow is actually completed
      }

      return comprehensiveResult;
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
export { EncodeForProcessingStep } from "./encode-for-processing";
export { WorkflowProgressReporter } from "./progress-reporter";

// Export utility functions
export { processEncodingFormats, mergeTranscriptions } from "./utils";
