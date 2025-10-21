import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";

import type {
  Env,
  EncodingParams,
  WorkflowState,
  EncodingResult,
} from "./types";
import { EncodingParamsSchema } from "./types";
import {
  EncodingService,
  type EncodingServiceConfig,
} from "../../encoding/service";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import { EpisodeRepository } from "../../episodes/repository";

export class EncodingWorkflow extends WorkflowEntrypoint<Env, EncodingParams> {
  private readonly totalSteps = 3;

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
    taskId?: string
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

      await taskService.updateTaskStep(taskIdNum, stepMessage, progress);
    } catch (error) {
      console.error("Error updating step progress:", error);
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
    console.error(
      `Encoding workflow failed at step ${stepName}:`,
      errorMessage
    );

    try {
      if (workflowId) {
        const { WorkflowService } = await import("../service.js");
        const workflowService = new WorkflowService(this.env.DB);
        await workflowService.failWorkflow(
          workflowId,
          fullErrorMessage,
          undefined
        );
      } else if (taskId) {
        await this.updateWorkflowStatus(taskId, "failed", fullErrorMessage);
      }
    } catch (updateError) {
      console.error("Failed to update workflow failure status:", updateError);
    }
  }

  async run(event: WorkflowEvent<EncodingParams>, step: WorkflowStep) {
    let validatedParams: EncodingParams;

    // Extract taskId and workflowId early for error handling
    const taskId = event.payload.taskId;
    const workflowId = event.payload.workflowId;

    try {
      validatedParams = EncodingParamsSchema.parse(event.payload);
    } catch (error) {
      console.error("Invalid workflow parameters:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Fail the task immediately if validation fails
      await this.handleWorkflowError(
        "validation",
        new Error(`Invalid workflow parameters: ${errorMessage}`),
        taskId,
        workflowId
      );

      throw new Error(`Invalid workflow parameters: ${errorMessage}`);
    }

    const workflowState: WorkflowState = {
      episodeId: validatedParams.episodeId,
      audioR2Key: validatedParams.audioR2Key,
      encodingFormats: validatedParams.encodingFormats,
      taskId: validatedParams.taskId,
      workflowId: validatedParams.workflowId,
      organizationId: validatedParams.organizationId,
      startedAt: new Date().toISOString(),
    };

    let currentStep: string = "initialization";

    try {
      await this.updateWorkflowStatus(
        validatedParams.taskId,
        "processing",
        "Encoding workflow started"
      );

      console.log(
        `Starting encoding workflow for episode ${validatedParams.episodeId}`
      );

      // Step 1: Initialize and validate
      currentStep = "initialize";
      const initResult = await step.do("initialize", async () => {
        await this.updateStepProgress(
          1,
          "Initializing encoding workflow",
          validatedParams.taskId
        );

        // Validate that the audio file exists in R2
        const actualR2Key = workflowState.audioR2Key.startsWith("r2://")
          ? workflowState.audioR2Key.substring(5)
          : workflowState.audioR2Key;

        const object = await this.env.BUCKET.get(actualR2Key);
        if (!object) {
          throw new Error(`Audio file not found in R2: ${actualR2Key}`);
        }

        // Validate required configuration
        if (!this.env.STORAGE_SIGNATURE_SECRET) {
          throw new Error(
            "Storage signature secret not configured (STORAGE_SIGNATURE_SECRET required)"
          );
        }

        if (!this.env.SERVICE_BASE_URL) {
          throw new Error(
            "Service base URL not configured (SERVICE_BASE_URL required)"
          );
        }

        // Create storage env with required types
        const storageEnv = {
          BUCKET: this.env.BUCKET,
          STORAGE_SIGNATURE_SECRET: this.env.STORAGE_SIGNATURE_SECRET,
          SERVICE_BASE_URL: this.env.SERVICE_BASE_URL,
        };

        // Generate signed download URL for input using worker storage wrapper
        const downloadUrlResult = await generateSignedDownloadUrl(
          storageEnv,
          actualR2Key,
          3600 // 1 hour
        );

        // Generate signed upload URLs for each output format
        const outputUrls: Array<{
          format: string;
          bitrate: number;
          uploadUrl: string;
          metadataUrl: string;
          r2Key: string;
          metadataR2Key: string;
        }> = [];

        for (const formatSpec of workflowState.encodingFormats) {
          const [format, bitrateStr] = formatSpec.split("_");
          const bitrate = parseInt(bitrateStr);

          // Generate output R2 key
          const encodedR2Key = `episodes/${workflowState.episodeId}/audio_${bitrate}kbps.${format}`;
          const metadataR2Key = `episodes/${workflowState.episodeId}/audio_${bitrate}kbps_metadata.json`;

          // Generate signed upload URL using worker storage wrapper
          const uploadUrlResult = await generateSignedUploadUrl(
            storageEnv,
            encodedR2Key,
            `audio/${format}`,
            3600 // 1 hour
          );

          // Generate signed upload URL for metadata JSON
          const metadataUrlResult = await generateSignedUploadUrl(
            storageEnv,
            metadataR2Key,
            "application/json",
            3600 // 1 hour
          );

          outputUrls.push({
            format,
            bitrate,
            uploadUrl: uploadUrlResult.url,
            metadataUrl: metadataUrlResult.url,
            r2Key: encodedR2Key,
            metadataR2Key,
          });
        }

        return {
          audioSize: object.size,
          actualR2Key,
          audioDownloadUrl: downloadUrlResult.url,
          outputUrls,
        };
      });

      // Step 2: Encode audio to podcast formats
      currentStep = "encode-audio";
      const encodingResults = await step.do(
        "encode-audio",
        {
          retries: {
            limit: 2,
            delay: "10 seconds",
          },
          timeout: "15 minutes",
        },
        async () => {
          await this.updateStepProgress(
            2,
            "Encoding audio to podcast formats",
            validatedParams.taskId
          );

          const audioDownloadUrl = initResult.audioDownloadUrl;

          // Determine encoding service provider
          const provider = this.env.ENCODING_SERVICE_PROVIDER || "cloudflare";
          let encodingConfig: EncodingServiceConfig;

          if (provider === "aws" && this.env.AWS_LAMBDA_ENCODING_URL) {
            encodingConfig = {
              type: "aws-lambda",
              awsLambda: {
                functionUrl: this.env.AWS_LAMBDA_ENCODING_URL,
                apiKey: this.env.AWS_LAMBDA_API_KEY,
              },
            };
          } else if (this.env.ENCODING_CONTAINER) {
            encodingConfig = {
              type: "cloudflare",
              cloudflare: {
                container: this.env.ENCODING_CONTAINER,
              },
            };
          } else {
            throw new Error(
              "No encoding service available. Please configure either AWS_LAMBDA_ENCODING_URL or ENCODING_CONTAINER"
            );
          }

          const encodingService = new EncodingService(encodingConfig);
          const results: EncodingResult[] = [];
          const encodingDetails: Array<{
            format: string;
            bitrate: number;
            inputUrl: string;
            outputUrl: string;
            metadataUrl: string;
            outputKey: string;
            metadataKey: string;
          }> = [];

          // Encode to each requested format using pre-generated URLs
          for (const outputUrlInfo of initResult.outputUrls) {
            const {
              format,
              bitrate,
              uploadUrl,
              metadataUrl,
              r2Key: encodedR2Key,
              metadataR2Key,
            } = outputUrlInfo;

            // Store encoding details for debugging
            encodingDetails.push({
              format,
              bitrate,
              inputUrl: audioDownloadUrl,
              outputUrl: uploadUrl,
              metadataUrl,
              outputKey: encodedR2Key,
              metadataKey: metadataR2Key,
            });

            // Encode the audio using presigned URLs (no R2 credentials needed)
            // Lambda will also generate and upload comprehensive metadata JSON
            const encodeResponse = await encodingService.encode({
              audioUrl: audioDownloadUrl,
              outputUrl: uploadUrl,
              metadataUrl,
              outputFormat: format,
              bitrate,
            });

            if (!encodeResponse.success) {
              throw new Error(
                `Encoding to ${format} failed: ${
                  encodeResponse.error || "Unknown error"
                }`
              );
            }

            results.push({
              format,
              bitrate,
              r2Key: encodedR2Key,
              metadataR2Key,
              duration: encodeResponse.input?.duration || 0,
              size: encodeResponse.output?.size || 0,
            });
          }

          return { encodings: results, encodingDetails };
        }
      );

      // Step 3: Update episode with encoded URLs
      currentStep = "update-episode";
      await step.do(
        "update-episode",
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
            "Updating episode with encodings",
            validatedParams.taskId
          );

          // Build encoded audio URLs with metadata
          const encodedAudioUrls = encodingResults.encodings.reduce(
            (
              acc: Record<
                string,
                { url: string; metadataUrl: string; duration: number }
              >,
              encoding: EncodingResult
            ) => {
              const key = `${encoding.format}_${encoding.bitrate}kbps`;
              const url = `${this.env.R2_ENDPOINT}/${encoding.r2Key}`;
              const metadataUrl = `${this.env.R2_ENDPOINT}/${encoding.metadataR2Key}`;
              acc[key] = {
                url,
                metadataUrl,
                duration: encoding.duration,
              };
              return acc;
            },
            {} as Record<
              string,
              { url: string; metadataUrl: string; duration: number }
            >
          );

          const episodeRepository = new EpisodeRepository(this.env.DB);
          await episodeRepository.updateByIdOnly(workflowState.episodeId, {
            encodedAudioUrls: JSON.stringify(encodedAudioUrls),
            duration: encodingResults.encodings[0]?.duration || 0,
          });

          return {
            encodedAudioUrls,
            encodingDetails: encodingResults.encodingDetails,
          };
        }
      );

      // Prepare final result
      const finalResult = {
        success: true,
        episodeId: workflowState.episodeId,
        workflowId: workflowState.workflowId,
        completedAt: new Date().toISOString(),
        encodings: encodingResults.encodings,
        encodingDetails: encodingResults.encodingDetails,
        initResult: {
          audioSize: initResult.audioSize,
          audioDownloadUrl: initResult.audioDownloadUrl,
          actualR2Key: initResult.actualR2Key,
          outputUrls: initResult.outputUrls,
        },
      };

      // Mark workflow as completed
      currentStep = "workflow-completion";
      try {
        if (validatedParams.workflowId) {
          const { WorkflowService } = await import("../service.js");
          const workflowService = new WorkflowService(this.env.DB);
          await workflowService.completeWorkflow(
            validatedParams.workflowId,
            finalResult,
            undefined
          );
          console.log(
            `Encoding workflow completed successfully for episode ${validatedParams.episodeId}`
          );
        } else {
          await this.updateWorkflowStatus(
            validatedParams.taskId,
            "done",
            "Encoding completed successfully"
          );
        }
      } catch (error) {
        console.error("Failed to set final workflow status:", error);
      }

      return finalResult;
    } catch (error: any) {
      console.error(`Encoding workflow failed at step: ${currentStep}`, error);
      await this.handleWorkflowError(currentStep, error, taskId, workflowId);
      throw error;
    }
  }
}

export * from "./types";
