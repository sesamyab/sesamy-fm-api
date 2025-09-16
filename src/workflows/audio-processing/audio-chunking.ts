import { v4 as uuidv4 } from "uuid";
import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import type { Env, ChunkingResult, EncodedAudio, WorkflowState } from "./types";

export async function audioChunking(
  env: Env,
  workflowState: WorkflowState,
  encodedAudio: EncodedAudio
): Promise<ChunkingResult> {
  // Step 1: Prepare chunk storage (moved from prepare-chunk-storage step)
  console.log("Preparing chunk storage based on encoded audio duration...");

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
    const chunkR2Key = `chunks/${workflowState.episodeId}/${chunkId}.mp3`;

    // Generate a presigned PUT URL for chunk upload
    const chunkUploadResult = await generateSignedUploadUrl(
      env,
      chunkR2Key,
      "audio/mpeg", // Content-Type for MP3 chunks
      3600 // 1 hour expiration
    );

    chunkUploadUrls.push({
      index: i,
      r2Key: chunkR2Key,
      uploadUrl: chunkUploadResult.url,
    });
  }

  console.log(`Prepared storage for ${expectedChunks} expected chunks`);

  // Step 2: Perform audio chunking
  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  // Enhanced retry logic for chunking with rate limiting support
  const maxRetryTime = 60 * 60 * 1000; // 1 hour in milliseconds
  const baseDelay = 10 * 1000; // 10 seconds base delay
  const maxDelay = 5 * 60 * 1000; // 5 minutes max delay
  const startTime = Date.now();
  let attempt = 0;
  let chunkResponse;

  while (Date.now() - startTime < maxRetryTime) {
    attempt++;

    try {
      console.log(
        `Chunking attempt ${attempt} (${Math.round(
          (Date.now() - startTime) / 1000
        )}s elapsed)`
      );

      // Generate progress callback URL for this chunking operation
      const progressCallbackUrl = env.SERVICE_BASE_URL
        ? `${env.SERVICE_BASE_URL}/internal/encoding-progress`
        : undefined;

      chunkResponse = await container.fetch("http://localhost:8080/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: encodedAudio.encodedAudioUrl, // Use encoded file
          chunkUploadUrls: chunkUploadUrls,
          outputFormat: "mp3", // Use MP3 format for chunks (supported by container)
          bitrate: 48, // Use 48 kbps to match encoding step
          chunkDuration: workflowState.chunkDuration,
          overlapDuration: workflowState.overlapDuration,
          duration: totalDuration, // Pass the pre-determined duration
          progressCallbackUrl,
          // Include task and step information for progress tracking
          taskId: workflowState.taskId
            ? parseInt(workflowState.taskId)
            : undefined,
          step: "audio_chunking",
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

        // Handle rate limiting (429) responses
        if (chunkResponse.status === 429) {
          const retryAfter = errorData.retryAfter || 10;
          console.log(
            `Chunking rate limited on attempt ${attempt}. Retrying after ${retryAfter}s...`
          );

          // Check if we have time left for another retry
          const timeLeft = maxRetryTime - (Date.now() - startTime);
          if (timeLeft < retryAfter * 1000 + 30000) {
            // Need at least retry delay + 30s buffer
            throw new Error(
              `Chunking rate limited and insufficient time remaining (${Math.round(
                timeLeft / 1000
              )}s left)`
            );
          }

          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000)
          );
          continue;
        }

        // Check if this is a retryable error
        if (
          errorText.includes("Container suddenly disconnected") ||
          errorText.includes("Container not available") ||
          chunkResponse.status === 503
        ) {
          const timeElapsed = Date.now() - startTime;
          const timeLeft = maxRetryTime - timeElapsed;

          if (timeLeft <= 0) {
            throw new Error(
              `Chunking failed after max retry time: ${errorText}`
            );
          }

          // Calculate exponential backoff delay
          const delay = Math.min(
            baseDelay * Math.pow(2, attempt - 1),
            maxDelay
          );

          if (timeLeft > delay + 30000) {
            // Ensure we have buffer time
            console.log(
              `Retryable chunking error on attempt ${attempt}: ${errorText}. Retrying in ${
                delay / 1000
              }s... (${Math.round(timeLeft / 1000)}s left)`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            throw new Error(
              `Insufficient time left for chunking retry. ${Math.round(
                timeLeft / 1000
              )}s remaining`
            );
          }
        }

        throw new Error(
          `Chunking failed: ${chunkResponse.status} - ${errorText}`
        );
      }

      // Success - break out of retry loop
      break;
    } catch (error) {
      const timeElapsed = Date.now() - startTime;
      const timeLeft = maxRetryTime - timeElapsed;

      if (timeLeft <= 0) {
        const totalTime = Math.round(timeElapsed / 1000);
        throw new Error(
          `Chunking failed after ${totalTime}s (${attempt} attempts): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      // If this is already a formatted error from above, just re-throw
      if (
        error instanceof Error &&
        (error.message.includes("rate limited") ||
          error.message.includes("Insufficient time") ||
          error.message.includes("after max retry time"))
      ) {
        throw error;
      }

      // For other errors, use exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      if (timeLeft > delay + 30000) {
        console.log(
          `Chunking error on attempt ${attempt}: ${
            error instanceof Error ? error.message : String(error)
          }. Retrying in ${delay / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      } else {
        throw error;
      }
    }
  }

  // Ensure chunkResponse exists at this point
  if (!chunkResponse) {
    throw new Error("Chunking failed: no response received after retries");
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
