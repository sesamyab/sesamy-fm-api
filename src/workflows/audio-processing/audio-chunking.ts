import { generateSignedDownloadUrl } from "../../utils/storage";
import type {
  Env,
  ChunkingResult,
  AudioMetadata,
  WorkflowState,
} from "./types";

export async function audioChunking(
  env: Env,
  workflowState: WorkflowState,
  audioMetadata: AudioMetadata
): Promise<ChunkingResult> {
  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  // Use the encoded audio file for chunking (much faster processing)
  const chunkResponse = await container.fetch("http://localhost:8080/chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioUrl: audioMetadata.encodedAudioUrl, // Use encoded file
      chunkUploadUrls: audioMetadata.chunkUploadUrls,
      outputFormat: "opus", // Use Opus format for chunks
      bitrate: 48, // Use 48 kbps to match encoding step
      chunkDuration: workflowState.chunkDuration,
      overlapDuration: workflowState.overlapDuration,
      duration: audioMetadata.duration, // Pass the pre-determined duration
    }),
  });

  if (!chunkResponse.ok) {
    const errorText = await chunkResponse.text();
    throw new Error(`Chunking failed: ${chunkResponse.status} - ${errorText}`);
  }

  const chunkResult = (await chunkResponse.json()) as any;

  if (!chunkResult.success || !chunkResult.chunks) {
    throw new Error(
      `Invalid chunking response: ${JSON.stringify(chunkResult)}`
    );
  }

  // Generate signed download URLs for each chunk
  const audioUrls = await Promise.all(
    chunkResult.chunks.map(async (chunk: any) => {
      // Generate signed download URL for this chunk
      const downloadUrl = await generateSignedDownloadUrl(
        env,
        chunk.r2Key,
        3600 // 1 hour expiration
      );

      return downloadUrl.url;
    })
  );

  return {
    chunks: audioUrls,
  };
}
