import { v4 as uuidv4 } from "uuid";
import { generateSignedUploadUrl } from "../../utils/storage";
import type { Env, AudioMetadata, EncodedAudio, WorkflowState } from "./types";

export async function prepareChunkStorage(
  env: Env,
  workflowState: WorkflowState,
  encodedAudio: EncodedAudio
): Promise<AudioMetadata> {
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
    const chunkR2Key = `chunks/${workflowState.episodeId}/${chunkId}.webm`;

    // Generate a presigned PUT URL for chunk upload
    const chunkUploadResult = await generateSignedUploadUrl(
      env,
      chunkR2Key,
      "audio/webm", // Content-Type for WebM/Opus chunks
      3600 // 1 hour expiration
    );

    chunkUploadUrls.push({
      index: i,
      r2Key: chunkR2Key,
      uploadUrl: chunkUploadResult.url,
    });
  }

  // Generate URL for reading the encoded audio file
  const encodedAudioDownloadUrl = encodedAudio.encodedAudioUrl; // Use pre-signed URL from previous step

  return {
    duration: totalDuration,
    expectedChunks,
    chunkUploadUrls,
    encodedAudioUrl: encodedAudioDownloadUrl,
    encodedR2Key: encodedAudio.encodedR2Key,
  };
}
