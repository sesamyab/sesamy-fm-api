import { v4 as uuidv4 } from "uuid";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import { R2PreSignedUrlGenerator } from "../../utils";
import type { Env, ChunkingResult, EncodedAudio, WorkflowState } from "./types";

export async function audioChunking(
  env: Env,
  workflowState: WorkflowState & {
    chunkDuration: number;
    overlapDuration: number;
  },
  encodedAudio: EncodedAudio
): Promise<ChunkingResult> {
  // Step 1: Prepare chunk storage (moved from prepare-chunk-storage step)

  // Calculate expected number of chunks using encoded audio duration
  const totalDuration = encodedAudio.duration;
  const expectedChunks = Math.ceil(totalDuration / workflowState.chunkDuration);

  // Pre-generate signed PUT URLs for all expected chunks
  const chunkUploadUrls: Array<{
    index: number;
    r2Key: string;
    uploadUrl: string;
  }> = [];

  for (let i = 0; i < expectedChunks; i++) {
    const chunkId = uuidv4();
    const chunkR2Key = `chunks/${workflowState.episodeId}/${chunkId}.ogg`;

    // Generate a presigned PUT URL for chunk upload
    const chunkUploadResult = await generateSignedUploadUrl(
      env,
      chunkR2Key,
      "audio/ogg", // Content-Type for Opus files (stored in OGG container)
      3600 // 1 hour expiration
    );

    chunkUploadUrls.push({
      index: i,
      r2Key: chunkR2Key,
      uploadUrl: chunkUploadResult.url,
    });
  }

  // Step 2: Perform audio chunking
  // Create R2 presigned URL generator for direct R2 access (better for FFmpeg range requests)
  const r2Generator = new R2PreSignedUrlGenerator(
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_ENDPOINT
  );

  // The encodedAudioUrl is already a direct presigned URL from the TTS encode step
  // We can use it directly for FFmpeg - no need to regenerate it
  const directAudioUrl = encodedAudio.encodedAudioUrl;

  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  const chunkResponse = await container.fetch("http://localhost:8080/chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioUrl: directAudioUrl, // Use direct R2 presigned URL instead of storage endpoint
      chunkUploadUrls: chunkUploadUrls,
      chunkDuration: workflowState.chunkDuration,
      overlapDuration: workflowState.overlapDuration,
      duration: totalDuration, // Pass the pre-determined duration
    }),
  });

  if (!chunkResponse.ok) {
    const errorText = await chunkResponse.text();
    let errorData;

    // Try to parse error response as JSON for 429 responses
    try {
      errorData = JSON.parse(errorText);
    } catch {
      // Not JSON, use error text
      errorData = { error: errorText };
    }
    
    throw new Error(`Chunking request failed: ${JSON.stringify(errorData)}`);
  }

  const chunkResult = (await chunkResponse.json()) as any;

  if (!chunkResult.success || !chunkResult.chunks) {
    throw new Error(
      `Invalid chunking response: ${JSON.stringify(chunkResult)}`
    );
  }

  // Generate direct R2 presigned download URLs for each chunk
  const audioUrls = await Promise.all(
    chunkResult.chunks.map(async (chunk: any) => {
      // Generate direct R2 presigned URL for this chunk
      return await r2Generator.generatePresignedUrl(
        "podcast-service-assets",
        chunk.r2Key,
        3600 // 1 hour expiration
      );
    })
  );

  return {
    chunks: audioUrls,
  };
}
