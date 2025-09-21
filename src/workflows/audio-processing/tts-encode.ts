import { v4 as uuidv4 } from "uuid";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import { R2PreSignedUrlGenerator } from "../../utils";
import type { Env } from "./types";
import { WorkflowStateSchema, EncodedAudioSchema } from "./types";

/**
 * Encode audio for processing - converts audio to optimal format for TTS
 */
export async function encodeAudioForTTS(env: Env, workflowState: unknown) {
  // Validate input
  const validatedState = WorkflowStateSchema.parse(workflowState);

  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  // Strip r2:// prefix if present to get the actual R2 key
  const actualR2Key = validatedState.audioR2Key.startsWith("r2://")
    ? validatedState.audioR2Key.substring(5)
    : validatedState.audioR2Key;

  // Create R2 presigned URL generator for direct R2 access (better for FFmpeg range requests)
  const r2Generator = new R2PreSignedUrlGenerator(
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_ENDPOINT
  );

  // Generate direct R2 presigned download URL for reading the input audio file
  const audioDownloadUrl = await r2Generator.generatePresignedUrl(
    "podcast-service-assets",
    actualR2Key,
    3600 // 1 hour
  );

  // Generate R2 key for the encoded file
  const encodedFileId = uuidv4();
  const encodedR2Key = `processing/${validatedState.episodeId}/${encodedFileId}_24k_mono.ogg`;

  // Generate presigned URL for uploading the encoded file
  const encodedUploadResult = await generateSignedUploadUrl(
    env,
    encodedR2Key,
    "audio/ogg", // Content-Type for Opus files (stored in OGG container)
    3600 // 1 hour expiration
  );

  const encodeResponse = await container.fetch("http://localhost:8080/encode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioUrl: audioDownloadUrl,
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

    throw new Error(
      `Processing encoding failed: ${errorData.error || errorText}`
    );
  }

  const encodeResult: {
    metadata: {
      duration: number;
    };
  } = await encodeResponse.json();

  // Pre-sign download URL for the next step (prepare-chunk-storage)
  const encodedDownloadUrl = await r2Generator.generatePresignedUrl(
    "podcast-service-assets",
    encodedR2Key,
    3600 // 1 hour
  );

  const result = {
    encodedR2Key,
    encodedAudioUrl: encodedDownloadUrl, // Pre-signed for next step
    duration: encodeResult.metadata?.duration || 0,
    signedUrls: [audioDownloadUrl, encodedUploadResult.url, encodedDownloadUrl],
  };

  // Validate output and return
  return EncodedAudioSchema.parse(result);
}
