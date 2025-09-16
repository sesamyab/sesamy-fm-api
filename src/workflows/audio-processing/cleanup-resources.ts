import type { Env, EncodedAudio, ChunkingResult } from "./types";

// Helper function to extract R2 key from signed URL
function extractR2KeyFromUrl(signedUrl: string): string | null {
  try {
    const url = new URL(signedUrl);
    const pathname = url.pathname;

    // Remove leading slash and return the path as R2 key
    // Signed URLs typically have the format: https://domain.com/path/to/file.ext?signature...
    if (pathname.startsWith("/")) {
      return pathname.substring(1);
    }
    return pathname;
  } catch (error) {
    console.warn(`Failed to extract R2 key from URL: ${signedUrl}`, error);
    return null;
  }
}

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
  const cleanedFiles: string[] = [];

  // Clean up the temporary encoded processing file
  try {
    await env.BUCKET.delete(encodedAudio.encodedR2Key);
    cleanedFiles.push(encodedAudio.encodedR2Key);
  } catch (error) {
    console.warn(
      `Failed to delete encoded file ${encodedAudio.encodedR2Key}:`,
      error
    );
  }

  // Clean up chunk files from R2
  const chunkDeletePromises = chunkingResult.chunks.map(async (chunkUrl) => {
    const r2Key = extractR2KeyFromUrl(chunkUrl);
    if (r2Key) {
      try {
        await env.BUCKET.delete(r2Key);
        cleanedFiles.push(r2Key);
        console.log(`Deleted chunk file: ${r2Key}`);
      } catch (error) {
        console.warn(`Failed to delete chunk file ${r2Key}:`, error);
      }
    }
  });

  await Promise.all(chunkDeletePromises);

  return {
    cleanedUp: true,
    cleanedFiles,
    note: `Cleaned up ${cleanedFiles.length} files: temporary encoded file and ${chunkingResult.chunks.length} chunk files from R2`,
    chunkCount: chunkingResult.chunks.length,
  };
}
