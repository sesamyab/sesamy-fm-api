import type {
  Env,
  ChunkingResult,
  WorkflowState,
  TranscribedChunk,
  AudioChunk,
} from "./types";

export async function transcribeChunks(
  env: Env,
  workflowState: WorkflowState,
  chunkingResult: ChunkingResult
): Promise<TranscribedChunk[]> {
  // Validate chunks data before processing
  console.log(
    `Processing ${chunkingResult.chunks.length} audio chunks for transcription`
  );

  if (chunkingResult.chunks.length === 0) {
    throw new Error(`No chunks available for transcription.`);
  }

  const transcribeChunk = async (
    audioUrl: string,
    index: number
  ): Promise<TranscribedChunk | null> => {
    try {
      if (!audioUrl) {
        console.warn(`Skipping chunk ${index}: No audio URL available`);
        return null;
      }

      // Fetch chunk using the audio URL
      const response = await fetch(audioUrl);

      if (!response.ok) {
        console.warn(
          `Skipping chunk ${index}: Failed to fetch from audio URL: ${response.status}`
        );
        return null;
      }

      const audioArrayBuffer = await response.arrayBuffer();

      // Use the language parameter to force consistent language detection
      const transcriptionOptions: any = {
        audio: [...new Uint8Array(audioArrayBuffer)],
      };

      // Add language parameter if specified to avoid mixed language issues
      if (workflowState.transcriptionLanguage) {
        transcriptionOptions.language = workflowState.transcriptionLanguage;
      }

      const transcriptResponse = (await env.AI.run(
        "@cf/openai/whisper",
        transcriptionOptions
      )) as { text: string };

      if (!transcriptResponse || !transcriptResponse.text) {
        console.warn(
          `Skipping chunk ${index}: Whisper AI returned empty result`
        );
        return null;
      }

      const transcriptText = transcriptResponse.text.trim();

      return {
        text: transcriptText,
        startTime: index * 30, // Estimate based on index and 30s chunks
        endTime: (index + 1) * 30,
      };
    } catch (error) {
      const errorMsg = `Chunk ${index} transcription failed: ${
        error instanceof Error ? error.message : String(error)
      }`;

      console.warn(`Skipping chunk due to transcription error: ${errorMsg}`);
      return null;
    }
  };

  // Process chunks in batchesF
  const concurrencyLimit = 3;
  const transcribed: TranscribedChunk[] = [];
  let skippedChunks = 0;

  for (let i = 0; i < chunkingResult.chunks.length; i += concurrencyLimit) {
    const batch = chunkingResult.chunks.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((audioUrl, batchIndex) =>
        transcribeChunk(audioUrl, i + batchIndex)
      )
    );

    // Filter out null results (failed chunks) and count them
    const validResults = batchResults.filter(
      (result): result is TranscribedChunk => result !== null
    );
    skippedChunks += batchResults.length - validResults.length;

    transcribed.push(...validResults);
  }

  // Log information about skipped chunks
  if (skippedChunks > 0) {
    console.warn(
      `Transcription completed with ${skippedChunks} skipped chunks out of ${chunkingResult.chunks.length} total chunks`
    );
  }

  // Ensure we have at least some transcribed chunks
  if (transcribed.length === 0) {
    throw new Error(
      `All ${chunkingResult.chunks.length} chunks failed transcription. Cannot proceed without any transcribed content.`
    );
  }

  return transcribed;
}
