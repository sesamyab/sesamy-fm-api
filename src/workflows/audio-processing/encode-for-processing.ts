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
    const encodedR2Key = `processing/${workflowState.episodeId}/${encodedFileId}_48k_mono.mp3`;

    // Generate presigned URL for uploading the encoded file
    const encodedUploadResult = await generateSignedUploadUrl(
      this.env,
      encodedR2Key,
      "audio/mpeg", // Content-Type for MP3 files
      3600 // 1 hour expiration
    );

    // Encode to 48 kbps Opus mono for efficient processing with better quality
    const encodeResponse = await container.fetch(
      "http://localhost:8080/encode",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: audioDownloadUrl.url,
          uploadUrl: encodedUploadResult.url,
          outputFormat: "mp3", // Use MP3 codec (supported by container)
          bitrate: 48, // 48 kbps for better quality
          channels: 1, // Mono
          sampleRate: 16000, // 16 kHz for optimal transcription
        }),
      }
    );

    if (!encodeResponse.ok) {
      const errorText = await encodeResponse.text();
      throw new Error(
        `Failed to encode audio for processing: ${encodeResponse.status} - ${errorText}`
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
