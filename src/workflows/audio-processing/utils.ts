import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import type { Env, EncodingResult, TranscribedChunk } from "./types";

export async function processEncodingFormats(
  env: Env,
  container: DurableObjectStub,
  audioR2Key: string,
  formats: string[],
  episodeId: string,
  taskId?: number
): Promise<EncodingResult[]> {
  // Strip r2:// prefix if present to get the actual R2 key
  const actualR2Key = audioR2Key.startsWith("r2://")
    ? audioR2Key.substring(5)
    : audioR2Key;

  // Generate download URL for reading the input audio file
  const audioDownloadUrl = await generateSignedDownloadUrl(
    env,
    actualR2Key,
    3600 // 1 hour
  );

  const encodingPromises = formats.map(async (format) => {
    const [codec, bitrateStr] = format.split("_");
    const bitrate = parseInt(bitrateStr);

    // Generate R2 key for the encoded file
    const encodedR2Key = `encoded/${episodeId}/${format}.${codec}`;

    // Generate presigned PUT URL for uploading the encoded file
    const uploadResult = await generateSignedUploadUrl(
      env,
      encodedR2Key,
      codec === "mp3" ? "audio/mpeg" : "audio/wav",
      3600 // 1 hour expiration
    );

    // Enhanced retry logic for container rate limiting and disconnections
    const maxRetryTime = 60 * 60 * 1000; // 1 hour in milliseconds
    const baseDelay = 10 * 1000; // 10 seconds base delay
    const maxDelay = 5 * 60 * 1000; // 5 minutes max delay
    const startTime = Date.now();
    let attempt = 0;
    let lastError;

    while (Date.now() - startTime < maxRetryTime) {
      attempt++;
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minute timeout

      try {
        console.log(
          `Encoding attempt ${attempt} for format ${format} (${Math.round(
            (Date.now() - startTime) / 1000
          )}s elapsed)`
        );

        // Generate progress callback URL for this encoding
        const progressCallbackUrl = env.SERVICE_BASE_URL
          ? `${env.SERVICE_BASE_URL}/internal/encoding-progress`
          : undefined;

        const response = await container.fetch("http://localhost:8080/encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioUrl: audioDownloadUrl.url,
            uploadUrl: uploadResult.url,
            outputFormat: codec,
            bitrate,
            progressCallbackUrl,
            streaming: false, // Keep false for now, can be made configurable later
            // Include task and step information for progress tracking
            taskId: taskId,
            step: `encoding_${format}`,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          let errorData;

          // Try to parse error response as JSON for 429 responses
          try {
            errorData = JSON.parse(errorText);
          } catch {
            // Not JSON, use error text
            errorData = { error: errorText };
          }

          // Handle rate limiting (429) responses
          if (response.status === 429) {
            const retryAfter = errorData.retryAfter || 10;
            console.log(
              `Rate limited on attempt ${attempt}. Retrying after ${retryAfter}s...`
            );

            // Check if we have time left for another retry
            const timeLeft = maxRetryTime - (Date.now() - startTime);
            if (timeLeft < retryAfter * 1000 + 30000) {
              // Need at least retry delay + 30s buffer
              throw new Error(
                `Rate limited and insufficient time remaining (${Math.round(
                  timeLeft / 1000
                )}s left)`
              );
            }

            await new Promise((resolve) =>
              setTimeout(resolve, retryAfter * 1000)
            );
            continue;
          }

          // Check if this is a container disconnection error
          if (
            errorText.includes("Container suddenly disconnected") ||
            errorText.includes("Container not available") ||
            response.status === 503
          ) {
            throw new Error(`Container disconnected: ${errorText}`);
          }

          throw new Error(
            `Encoding failed for ${format}: ${response.status} - ${errorText}`
          );
        }

        const encodingData = (await response.json()) as any;
        if (!encodingData.success) {
          throw new Error(
            `Encoding failed for ${format}: ${encodingData.error}`
          );
        }

        // Success - return the result
        return {
          format: codec,
          bitrate,
          r2Key: encodedR2Key, // Workflow tracks the R2 key
          size: encodingData.metadata.size,
          duration: encodingData.metadata.duration,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;

        const isRetryableError =
          error instanceof Error &&
          (error.message.includes("Container suddenly disconnected") ||
            error.message.includes("Container not available") ||
            error.message.includes("AbortError") ||
            error.message.includes("network") ||
            error.message.includes("Rate limited"));

        if (isRetryableError) {
          const timeElapsed = Date.now() - startTime;
          const timeLeft = maxRetryTime - timeElapsed;

          if (timeLeft <= 0) {
            console.log(`Max retry time (1 hour) exceeded for ${format}`);
            break;
          }

          // Calculate exponential backoff delay, but respect rate limit delays
          const exponentialDelay = Math.min(
            baseDelay * Math.pow(2, attempt - 1),
            maxDelay
          );
          const delay = error.message.includes("Rate limited")
            ? 0
            : exponentialDelay; // Rate limited errors already waited

          if (delay > 0 && timeLeft > delay + 30000) {
            // Ensure we have buffer time
            console.log(
              `Retryable error on attempt ${attempt}: ${
                error.message
              }. Retrying in ${delay / 1000}s... (${Math.round(
                timeLeft / 1000
              )}s left)`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else if (delay === 0) {
            console.log(
              `Retrying immediately after rate limit (attempt ${attempt})`
            );
          } else {
            console.log(
              `Insufficient time left for retry delay. ${Math.round(
                timeLeft / 1000
              )}s remaining`
            );
            break;
          }
          continue;
        } else {
          // Non-retryable error
          throw error;
        }
      }
    }

    // If we get here, max time exceeded
    const totalTime = Math.round((Date.now() - startTime) / 1000);
    throw new Error(
      `Encoding failed for ${format} after ${totalTime}s (${attempt} attempts): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  });

  return Promise.all(encodingPromises);
}

export function mergeTranscriptions(
  chunks: TranscribedChunk[],
  overlapDuration: number
): { text: string; totalWords: number } {
  if (chunks.length === 0) return { text: "", totalWords: 0 };
  if (chunks.length === 1) {
    const wordCount = chunks[0].text
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
    return { text: chunks[0].text, totalWords: wordCount };
  }

  let mergedText = chunks[0].text;

  for (let i = 1; i < chunks.length; i++) {
    const currentChunk = chunks[i];
    const previousChunk = chunks[i - 1];

    const overlapStartTime = currentChunk.startTime;
    const overlapEndTime = previousChunk.endTime;
    const actualOverlap = Math.min(
      overlapEndTime - overlapStartTime,
      overlapDuration
    );

    if (actualOverlap > 0) {
      const chunkDuration = currentChunk.endTime - currentChunk.startTime;
      const estimatedOverlapRatio = actualOverlap / chunkDuration;
      const currentWords = currentChunk.text.trim().split(/\s+/);
      const wordsToSkip = Math.floor(
        currentWords.length * estimatedOverlapRatio
      );
      const nonOverlapWords = currentWords.slice(wordsToSkip);
      mergedText += " " + nonOverlapWords.join(" ");
    } else {
      mergedText += " " + currentChunk.text;
    }
  }

  const totalWords = mergedText
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return { text: mergedText.trim(), totalWords };
}
