import type { Env, EncodedAudio, ChunkingResult } from "./types";

export async function cleanupResources(
  env: Env,
  encodedAudio: EncodedAudio,
  chunkingResult: ChunkingResult
): Promise<{
  cleanedUp: boolean;
  cleanedFiles: string[];
  note: string;
  chunkCount: number;
}> {
  // Clean up the temporary encoded processing file
  try {
    await env.BUCKET.delete(encodedAudio.encodedR2Key);
  } catch (error) {
    // Non-critical error, continue
  }

  // Optionally delete chunk files after transcription is complete
  // For now, we'll keep them for debugging and potential reuse
  // Uncomment below to delete chunks:
  /*
  const deletePromises = chunkingResult.chunks.map(async (chunk) => {
    if (chunk.r2Key) {
      await env.BUCKET.delete(chunk.r2Key);
    }
  });
  await Promise.all(deletePromises);
  */

  return {
    cleanedUp: true,
    cleanedFiles: [encodedAudio.encodedR2Key],
    note: "Chunk files kept in R2 for debugging, temporary encoded file deleted",
    chunkCount: chunkingResult.chunks.length,
  };
}
