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

    const response = await container.fetch("http://localhost:8080/encode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioUrl: audioDownloadUrl.url,
        uploadUrl: uploadResult.url,
        outputFormat: codec,
        bitrate,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Encoding failed for ${format}: ${response.status} - ${errorText}`
      );
    }

    const encodingData = (await response.json()) as any;
    if (!encodingData.success) {
      throw new Error(`Encoding failed for ${format}: ${encodingData.error}`);
    }

    return {
      format: codec,
      bitrate,
      r2Key: encodedR2Key, // Workflow tracks the R2 key
      size: encodingData.metadata.size,
      duration: encodingData.metadata.duration,
    };
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
