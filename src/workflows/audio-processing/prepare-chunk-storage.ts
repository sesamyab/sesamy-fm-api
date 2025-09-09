import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { generateSignedUploadUrl } from "../../utils/storage";
import type {
  Env,
  AudioMetadata,
  EncodedAudio,
  WorkflowState,
  WorkflowStep,
} from "./types";
import {
  WorkflowStateSchema,
  EncodedAudioSchema,
  AudioMetadataSchema,
} from "./types";

// Input/Output schemas for this step
const PrepareInputSchema = z.object({
  workflowState: WorkflowStateSchema,
  encodedAudio: EncodedAudioSchema,
});
const PrepareOutputSchema = AudioMetadataSchema;

type PrepareInput = z.infer<typeof PrepareInputSchema>;
type PrepareOutput = z.infer<typeof PrepareOutputSchema>;

export class PrepareChunkStorageStep
  implements WorkflowStep<PrepareInput, PrepareOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): PrepareInput {
    return PrepareInputSchema.parse(input);
  }

  validateOutput(output: unknown): PrepareOutput {
    return PrepareOutputSchema.parse(output);
  }

  async execute(input: PrepareInput): Promise<PrepareOutput> {
    const { workflowState, encodedAudio } = this.validateInput(input);

    // Calculate expected number of chunks using encoded audio duration
    const totalDuration = encodedAudio.duration;
    const expectedChunks = Math.ceil(
      totalDuration / workflowState.chunkDuration
    );

    // Pre-generate signed PUT URLs for all expected chunks
    const chunkUploadUrls: Array<{
      index: number;
      r2Key: string;
      uploadUrl: string;
    }> = [];

    const signedUrls: string[] = [];

    for (let i = 0; i < expectedChunks; i++) {
      const chunkId = uuidv4();
      const chunkR2Key = `chunks/${workflowState.episodeId}/${chunkId}.mp3`;

      // Generate a presigned PUT URL for chunk upload
      const chunkUploadResult = await generateSignedUploadUrl(
        this.env,
        chunkR2Key,
        "audio/mpeg", // Content-Type for MP3 chunks
        3600 // 1 hour expiration
      );

      chunkUploadUrls.push({
        index: i,
        r2Key: chunkR2Key,
        uploadUrl: chunkUploadResult.url,
      });

      signedUrls.push(chunkUploadResult.url);
    }

    // Generate URL for reading the encoded audio file
    const encodedAudioDownloadUrl = encodedAudio.encodedAudioUrl; // Use pre-signed URL from previous step
    signedUrls.push(encodedAudioDownloadUrl);

    const result = {
      duration: totalDuration,
      expectedChunks,
      chunkUploadUrls,
      encodedAudioUrl: encodedAudioDownloadUrl,
      encodedR2Key: encodedAudio.encodedR2Key,
      signedUrls,
    };

    return this.validateOutput(result);
  }
}

// Legacy function for backward compatibility
export async function prepareChunkStorage(
  env: Env,
  workflowState: WorkflowState,
  encodedAudio: EncodedAudio
): Promise<AudioMetadata> {
  const step = new PrepareChunkStorageStep(env);
  const result = await step.execute({ workflowState, encodedAudio });
  // Remove signedUrls for legacy compatibility
  const { signedUrls, ...legacyResult } = result;
  return legacyResult;
}
