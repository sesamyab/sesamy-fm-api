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
  async run(event: WorkflowEvent<AudioProcessingParams>, step: WorkflowStep) {
    // Validate input parameters using Zod
    const validatedParams = AudioProcessingParamsSchema.parse(event.payload);

    // Step 1: Initialize workflow and validate inputs
    const workflowState = await step.do("initialize-workflow", async () => {
      const initStep = new InitializeWorkflowStep(this.env);
      const result = await initStep.execute(validatedParams);
      // Return legacy format for backward compatibility
      const { signedUrls, ...legacyResult } = result;
      return legacyResult;
    });

    // Step 2: Encode audio to 48 kbps Opus mono for efficient processing
    const encodedAudio = await step.do(
      "encode-for-processing",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "10 minutes",
      },
      async () => {
        const encodeStep = new EncodeForProcessingStep(this.env);
        const result = await encodeStep.execute(workflowState);
        // Return legacy format for backward compatibility
        const { signedUrls, ...legacyResult } = result;
        return legacyResult;
      }
    );

    // Step 3: Prepare R2 storage for chunks using encoded audio duration
    const audioMetadata = await step.do(
      "prepare-chunk-storage",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "2 minutes",
      },
      async () => {
        const prepareStep = new PrepareChunkStorageStep(this.env);
        const result = await prepareStep.execute({
          workflowState,
          encodedAudio,
        });
        // Return legacy format for backward compatibility
        const { signedUrls, ...legacyResult } = result;
        return legacyResult;
      }
    );

    // Step 4: Audio Chunking for Transcription using encoded file
    const chunkingResult = await step.do(
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
        return await audioChunking(this.env, workflowState, audioMetadata);
      }
    );

    // Step 5: Transcribe chunks in parallel
    const transcribedChunks = await step.do(
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
        return await transcribeChunks(this.env, workflowState, chunkingResult);
      }
    );

    // Step 6: Audio Encoding (CPU-intensive operation)
    const encodingResult = await step.do(
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
        return await audioEncoding(this.env, workflowState);
      }
    );

    // Step 7: Update episode with encoded audio URLs
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
        return await updateEpisodeEncodings(
          this.env,
          workflowState,
          encodingResult.encodings
        );
      }
    );

    // Step 8: Cleanup temporary files from R2 (optional)
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
        return await cleanupResources(this.env, encodedAudio, chunkingResult);
      }
    );

    // Step 9: Final processing and store transcript
    const finalResult = await step.do(
      "finalize-processing",
      {
        retries: {
          limit: 2,
          delay: "2 seconds",
        },
        timeout: "5 minutes",
      },
      async () => {
        return await finalizeProcessing(
          this.env,
          workflowState,
          transcribedChunks,
          encodingResult.encodings
        );
      }
    );

    return {
      success: true,
      episodeId: workflowState.episodeId,
      workflowId: workflowState.workflowId,
      ...finalResult,
    };
  }
}

// Export all types
export * from "./types";

// Export new step classes
export { InitializeWorkflowStep } from "./initialize-workflow";
export { EncodeForProcessingStep } from "./encode-for-processing";
export { PrepareChunkStorageStep } from "./prepare-chunk-storage";

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
