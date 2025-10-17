import { v4 as uuidv4 } from "uuid";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import { R2PreSignedUrlGenerator } from "../../utils";
import {
  EncodingService,
  type EncodingServiceConfig,
} from "../../encoding/service";
import type { Env } from "./types";
import { WorkflowStateSchema, EncodedAudioSchema } from "./types";

/**
 * Encode audio for processing - converts audio to optimal format for TTS
 * Uses either AWS Lambda or Cloudflare Container based on configuration
 */
export async function encodeAudioForTTS(env: Env, workflowState: unknown) {
  // Validate input
  const validatedState = WorkflowStateSchema.parse(workflowState);

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
    3600, // 1 hour
    "GET"
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

  // Determine encoding service provider
  const provider = env.ENCODING_SERVICE_PROVIDER || "cloudflare";

  // Configure encoding service based on provider
  let encodingConfig: EncodingServiceConfig;

  if (provider === "aws" && env.AWS_LAMBDA_ENCODING_URL) {
    console.log("Using AWS Lambda encoding service");
    encodingConfig = {
      type: "aws-lambda",
      awsLambda: {
        functionUrl: env.AWS_LAMBDA_ENCODING_URL,
        apiKey: env.AWS_LAMBDA_API_KEY,
      },
    };
  } else {
    console.log("Using Cloudflare Container encoding service");
    encodingConfig = {
      type: "cloudflare",
      cloudflare: {
        container: env.ENCODING_CONTAINER,
      },
    };
  }

  // Create encoding service
  const encodingService = new EncodingService(encodingConfig);

  // Encode the audio
  const encodeResponse = await encodingService.encode({
    audioUrl: audioDownloadUrl,
    outputUrl: encodedUploadResult.url,
    outputFormat: "opus",
    bitrate: 24,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    storageEndpoint: env.R2_ENDPOINT,
  });

  if (!encodeResponse.success) {
    throw new Error(
      `Processing encoding failed: ${encodeResponse.error || "Unknown error"}`
    );
  }

  // Extract duration from response
  const duration = encodeResponse.input?.duration || 0;

  // Pre-sign download URL for the next step (prepare-chunk-storage)
  const encodedDownloadUrl = await r2Generator.generatePresignedUrl(
    "podcast-service-assets",
    encodedR2Key,
    3600, // 1 hour
    "GET"
  );

  const result = {
    encodedR2Key,
    encodedAudioUrl: encodedDownloadUrl, // Pre-signed for next step
    duration,
    signedUrls: [audioDownloadUrl, encodedUploadResult.url, encodedDownloadUrl],
  };

  // Validate output and return
  return EncodedAudioSchema.parse(result);
}
