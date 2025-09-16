import {
  generateSignedDownloadUrl,
  generateSignedUploadUrl,
} from "../../utils/storage";
import type { Env, EncodingResult, TranscribedChunk, Word } from "./types";

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
        const response = await container.fetch("http://localhost:8080/encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioUrl: audioDownloadUrl.url,
            uploadUrl: uploadResult.url,
            outputFormat: codec,
            bitrate,
            streaming: false, // Keep false for now, can be made configurable later
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
): {
  text: string;
  totalWords: number;
  words: Array<{ word: string; start: number; end: number }>;
} {
  if (chunks.length === 0) return { text: "", totalWords: 0, words: [] };

  // Collect all words from all chunks
  const allWords: Array<{ word: string; start: number; end: number }> = [];

  for (const chunk of chunks) {
    // Ensure each word has all required properties
    for (const word of chunk.words) {
      if (
        word.word &&
        typeof word.start === "number" &&
        typeof word.end === "number"
      ) {
        allWords.push({
          word: word.word,
          start: word.start,
          end: word.end,
        });
      }
    }
  }

  // Sort words by start time to ensure correct order
  allWords.sort((a, b) => a.start - b.start);

  // Remove overlapping words based on time overlap
  const mergedWords: Array<{ word: string; start: number; end: number }> = [];

  for (const word of allWords) {
    // Check if this word overlaps with the last added word
    const lastWord = mergedWords[mergedWords.length - 1];

    if (!lastWord) {
      // First word, always add
      mergedWords.push(word);
    } else {
      // Check for time overlap (allowing small tolerance for audio processing variations)
      const tolerance = 0.1; // 100ms tolerance
      const hasOverlap = word.start < lastWord.end + tolerance;

      if (hasOverlap) {
        // Skip this word as it's likely a duplicate from chunk overlap
        console.log(
          `Skipping overlapping word: "${word.word}" at ${word.start}s (overlaps with "${lastWord.word}" ending at ${lastWord.end}s)`
        );
      } else {
        // No overlap, add the word
        mergedWords.push(word);
      }
    }
  }

  // Generate final text by joining all words
  const finalText = mergedWords.map((w) => w.word).join(" ");

  return {
    text: finalText,
    totalWords: mergedWords.length,
    words: mergedWords,
  };
}
