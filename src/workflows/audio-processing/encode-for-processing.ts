import { v4 as uuidv4 } from "uuid";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import type { Env, EncodedAudio, WorkflowState } from "./types";

export async function encodeForProcessing(
  env: Env,
  workflowState: WorkflowState
): Promise<EncodedAudio> {
  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  // Strip r2:// prefix if present to get the actual R2 key
  const actualR2Key = workflowState.audioR2Key.startsWith("r2://")
    ? workflowState.audioR2Key.substring(5)
    : workflowState.audioR2Key;

  // Generate download URL for reading the input audio file
  const audioDownloadUrl = await generateSignedDownloadUrl(
    env,
    actualR2Key,
    3600 // 1 hour
  );

  // Generate R2 key for the encoded file
  const encodedFileId = uuidv4();
  const encodedR2Key = `processing/${workflowState.episodeId}/${encodedFileId}_48k_mono.webm`;

  // Generate presigned URL for uploading the encoded file
  const encodedUploadResult = await generateSignedUploadUrl(
    env,
    encodedR2Key,
    "audio/webm", // Content-Type for WebM/Opus files
    3600 // 1 hour expiration
  );

  // Encode to 48 kbps Opus mono for efficient processing with better quality
  const encodeResponse = await container.fetch("http://localhost:8080/encode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioUrl: audioDownloadUrl.url,
      uploadUrl: encodedUploadResult.url,
      outputFormat: "opus", // Use Opus codec
      bitrate: 48, // Improved from 32 to 48 kbps for better quality
      channels: 1, // Mono
      sampleRate: 16000, // 16 kHz for optimal transcription
    }),
  });

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
    env,
    encodedR2Key,
    3600 // 1 hour
  );

  return {
    encodedR2Key,
    encodedAudioUrl: encodedDownloadUrl.url, // Pre-signed for next step
    duration: encodeResult.metadata?.duration || 0,
  };
}
