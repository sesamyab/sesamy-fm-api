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
  episodeId: string
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

    // Retry logic for container disconnections
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minute timeout

      try {
        console.log(
          `Encoding attempt ${attempt}/${maxRetries} for format ${format}`
        );

        const response = await container.fetch("http://localhost:8080/encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioUrl: audioDownloadUrl.url,
            uploadUrl: uploadResult.url,
            outputFormat: codec,
            bitrate,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();

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
            error.message.includes("network"));

        if (isRetryableError && attempt < maxRetries) {
          console.log(
            `Retryable error on attempt ${attempt}: ${error.message}. Retrying...`
          );
          // Wait with exponential backoff before retry
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
          continue;
        } else {
          // Non-retryable error or max retries reached
          throw error;
        }
      }
    }

    // If we get here, all retries failed
    throw lastError;
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
