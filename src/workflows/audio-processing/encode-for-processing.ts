import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import type { Env, EncodedAudio, WorkflowState, WorkflowStep } from "./types";
import { WorkflowStateSchema, EncodedAudioSchema } from "./types";

// Input/Output schemas for this step
const EncodeInputSchema = WorkflowStateSchema;
const EncodeOutputSchema = EncodedAudioSchema;

type EncodeInput = z.infer<typeof EncodeInputSchema>;
type EncodeOutput = z.infer<typeof EncodeOutputSchema>;

export class EncodeForProcessingStep
  implements WorkflowStep<EncodeInput, EncodeOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): EncodeInput {
    return EncodeInputSchema.parse(input);
  }

  validateOutput(output: unknown): EncodeOutput {
    return EncodeOutputSchema.parse(output);
  }

  async execute(input: EncodeInput): Promise<EncodeOutput> {
    const workflowState = this.validateInput(input);

    // Get a reference to the encoding container
    const containerId =
      this.env.ENCODING_CONTAINER.idFromName("encoding-service");
    const container = this.env.ENCODING_CONTAINER.get(containerId);

    // Strip r2:// prefix if present to get the actual R2 key
    const actualR2Key = workflowState.audioR2Key.startsWith("r2://")
      ? workflowState.audioR2Key.substring(5)
      : workflowState.audioR2Key;

    // Generate download URL for reading the input audio file
    const audioDownloadUrl = await generateSignedDownloadUrl(
      this.env,
      actualR2Key,
      3600 // 1 hour
    );

    // Generate R2 key for the encoded file
    const encodedFileId = uuidv4();
    const encodedR2Key = `processing/${workflowState.episodeId}/${encodedFileId}_24k_mono.opus`;

    // Generate presigned URL for uploading the encoded file
    const encodedUploadResult = await generateSignedUploadUrl(
      this.env,
      encodedR2Key,
      "audio/opus", // Content-Type for Opus files
      3600 // 1 hour expiration
    );

    // Enhanced retry logic for encoding with rate limiting support
    const maxRetryTime = 60 * 60 * 1000; // 1 hour in milliseconds
    const baseDelay = 10 * 1000; // 10 seconds base delay
    const maxDelay = 5 * 60 * 1000; // 5 minutes max delay
    const startTime = Date.now();
    let attempt = 0;
    let encodeResponse;

    while (Date.now() - startTime < maxRetryTime) {
      attempt++;

      try {
        console.log(
          `Processing encoding attempt ${attempt} (${Math.round(
            (Date.now() - startTime) / 1000
          )}s elapsed)`
        );

        encodeResponse = await container.fetch("http://localhost:8080/encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioUrl: audioDownloadUrl.url,
            uploadUrl: encodedUploadResult.url,
            outputFormat: "opus",
            bitrate: 24,
            channels: 1, // Mono
            sampleRate: 16000, // 16 kHz for optimal transcription
          }),
        });

        if (!encodeResponse.ok) {
          const errorText = await encodeResponse.text();
          let errorData;

          // Try to parse error response as JSON for 429 responses
          try {
            errorData = JSON.parse(errorText);
          } catch {
            // Not JSON, use error text
            errorData = { error: errorText };
          }

          // Handle rate limiting (429) responses
          if (encodeResponse.status === 429) {
            const retryAfter = errorData.retryAfter || 10;
            console.log(
              `Processing encoding rate limited on attempt ${attempt}. Retrying after ${retryAfter}s...`
            );

            // Check if we have time left for another retry
            const timeLeft = maxRetryTime - (Date.now() - startTime);
            if (timeLeft < retryAfter * 1000 + 30000) {
              // Need at least retry delay + 30s buffer
              throw new Error(
                `Processing encoding rate limited and insufficient time remaining (${Math.round(
                  timeLeft / 1000
                )}s left)`
              );
            }

            await new Promise((resolve) =>
              setTimeout(resolve, retryAfter * 1000)
            );
            continue;
          }

          // Check if this is a retryable error
          if (
            errorText.includes("Container suddenly disconnected") ||
            errorText.includes("Container not available") ||
            encodeResponse.status === 503
          ) {
            const timeElapsed = Date.now() - startTime;
            const timeLeft = maxRetryTime - timeElapsed;

            if (timeLeft <= 0) {
              throw new Error(
                `Processing encoding failed after max retry time: ${errorText}`
              );
            }

            // Calculate exponential backoff delay
            const delay = Math.min(
              baseDelay * Math.pow(2, attempt - 1),
              maxDelay
            );

            if (timeLeft > delay + 30000) {
              // Ensure we have buffer time
              console.log(
                `Retryable processing encoding error on attempt ${attempt}: ${errorText}. Retrying in ${
                  delay / 1000
                }s... (${Math.round(timeLeft / 1000)}s left)`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            } else {
              throw new Error(
                `Insufficient time left for processing encoding retry. ${Math.round(
                  timeLeft / 1000
                )}s remaining`
              );
            }
          }

          throw new Error(
            `Failed to encode audio for processing: ${encodeResponse.status} - ${errorText}`
          );
        }

        // Success - break out of retry loop
        break;
      } catch (error) {
        const timeElapsed = Date.now() - startTime;
        const timeLeft = maxRetryTime - timeElapsed;

        if (timeLeft <= 0) {
          const totalTime = Math.round(timeElapsed / 1000);
          throw new Error(
            `Processing encoding failed after ${totalTime}s (${attempt} attempts): ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }

        // If this is already a formatted error from above, just re-throw
        if (
          error instanceof Error &&
          (error.message.includes("rate limited") ||
            error.message.includes("Insufficient time") ||
            error.message.includes("after max retry time"))
        ) {
          throw error;
        }

        // For other errors, use exponential backoff
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

        if (timeLeft > delay + 30000) {
          console.log(
            `Processing encoding error on attempt ${attempt}: ${
              error instanceof Error ? error.message : String(error)
            }. Retrying in ${delay / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        } else {
          throw error;
        }
      }
    }

    // Ensure encodeResponse exists at this point
    if (!encodeResponse) {
      throw new Error(
        "Processing encoding failed: no response received after retries"
      );
    }

    const encodeResult = (await encodeResponse.json()) as any;

    if (!encodeResult.success) {
      throw new Error(`Encoding failed: ${JSON.stringify(encodeResult)}`);
    }

    // Pre-sign download URL for the next step (prepare-chunk-storage)
    const encodedDownloadUrl = await generateSignedDownloadUrl(
      this.env,
      encodedR2Key,
      3600 // 1 hour
    );

    const result = {
      encodedR2Key,
      encodedAudioUrl: encodedDownloadUrl.url, // Pre-signed for next step
      duration: encodeResult.metadata?.duration || 0,
      signedUrls: [
        audioDownloadUrl.url,
        encodedUploadResult.url,
        encodedDownloadUrl.url,
      ],
    };

    return this.validateOutput(result);
  }
}

// Legacy function for backward compatibility
export async function encodeForProcessing(
  env: Env,
  workflowState: WorkflowState
): Promise<EncodedAudio> {
  const step = new EncodeForProcessingStep(env);
  const result = await step.execute(workflowState);
  // Remove signedUrls for legacy compatibility
  const { signedUrls, ...legacyResult } = result;
  return legacyResult;
}
