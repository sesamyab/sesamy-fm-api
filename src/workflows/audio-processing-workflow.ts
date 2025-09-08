import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import { EpisodeRepository } from "../episodes/repository";

// Enhanced workflow environment bindings
type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  ENCODING_CONTAINER: DurableObjectNamespace;
  AUDIO_PROCESSING_WORKFLOW: Workflow;
  // Secrets
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
};

// Enhanced workflow input parameters
type AudioProcessingParams = {
  episodeId: string;
  audioUrl: string;
  chunkDuration?: number;
  overlapDuration?: number;
  encodingFormats?: string[]; // e.g., ['mp3_128'] - bitrate auto-adjusted based on mono/stereo
  taskId?: string;
};

// Encoding result interface
interface EncodingResult {
  format: string;
  bitrate: number;
  url: string;
  size: number;
  duration?: number;
}

// Chunk interface for processing
interface AudioChunk {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  url?: string;
  chunkId?: string;
  metadata?: {
    format: string;
    bitrate: number;
    size: number;
    channels: number;
    sampleRate: number;
  };
}

// Transcribed chunk interface
interface TranscribedChunk {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
  wordCount: number;
}

export class AudioProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  AudioProcessingParams
> {
  async run(event: WorkflowEvent<AudioProcessingParams>, step: WorkflowStep) {
    const {
      episodeId,
      audioUrl,
      chunkDuration = 30,
      overlapDuration = 2,
      encodingFormats = ["mp3_128"], // Changed default to single MP3 format, bitrate will be auto-adjusted
      taskId,
    } = event.payload;

    console.log(`Starting audio processing workflow for episode ${episodeId}`);

    // Step 1: Initialize workflow and validate inputs
    const workflowState = await step.do("initialize-workflow", async () => {
      if (!episodeId || !audioUrl) {
        throw new Error("Episode ID and audio URL are required");
      }

      const workflowId = uuidv4();
      const timestamp = new Date().toISOString();

      console.log(
        `Initialized audio processing workflow ${workflowId} for episode ${episodeId}`
      );

      return {
        workflowId,
        episodeId,
        audioUrl,
        chunkDuration,
        overlapDuration,
        encodingFormats,
        startedAt: timestamp,
        taskId,
      };
    });

    // Step 2: Audio Chunking for Transcription (CPU-light operation first)
    const chunkingResult = await step.do(
      "audio-chunking",
      {
        retries: {
          limit: 3,
          delay: "10 seconds",
          backoff: "exponential",
        },
        timeout: "10 minutes",
      },
      async () => {
        console.log(
          `Starting audio chunking for transcription for episode ${episodeId}`
        );

        // Get a reference to the encoding container
        const containerId =
          this.env.ENCODING_CONTAINER.idFromName("encoding-service");
        const container = this.env.ENCODING_CONTAINER.get(containerId);

        // Process chunking for transcription
        const chunkingResults = await this.processAudioChunking(
          container,
          audioUrl,
          chunkDuration,
          overlapDuration
        );

        console.log(
          `Audio chunking completed: ${chunkingResults.chunks.length} chunks`
        );

        return {
          chunks: chunkingResults.chunks,
          totalChunks: chunkingResults.totalChunks,
          totalDuration: chunkingResults.totalDuration,
        };
      }
    );

    // Step 3: Audio Encoding (CPU-intensive operation second)
    const encodingResult = await step.do(
      "audio-encoding",
      {
        retries: {
          limit: 3,
          delay: "10 seconds",
          backoff: "exponential",
        },
        timeout: "15 minutes",
      },
      async () => {
        console.log(`Starting audio encoding for episode ${episodeId}`);

        // Get a reference to the encoding container
        const containerId =
          this.env.ENCODING_CONTAINER.idFromName("encoding-service");
        const container = this.env.ENCODING_CONTAINER.get(containerId);

        // Process encoding for different formats
        const encodingResults = await this.processEncodingFormats(
          container,
          audioUrl,
          encodingFormats
        );

        console.log(
          `Audio encoding completed: ${encodingResults.length} encodings`
        );

        return {
          encodings: encodingResults,
        };
      }
    );

    // Step 4: Store encoded files and chunks in R2
    const storageResult = await step.do(
      "store-processed-audio",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
          backoff: "linear",
        },
        timeout: "10 minutes",
      },
      async () => {
        console.log(
          `Storing ${encodingResult.encodings.length} encoded files and ${chunkingResult.chunks.length} chunks`
        );

        // Store encoded files in R2
        const encodingPromises = encodingResult.encodings.map(
          async (encoding, index) => {
            const fileName = `${episodeId}_${encoding.format}_${encoding.bitrate}kbps.${encoding.format}`;
            const key = `audio/${episodeId}/encoded/${fileName}`;

            const base64Data = encoding.encodedData;
            const buffer = Uint8Array.from(atob(base64Data), (c) =>
              c.charCodeAt(0)
            );

            await this.env.BUCKET.put(key, buffer, {
              httpMetadata: {
                contentType: `audio/${encoding.format}`,
              },
              customMetadata: {
                episodeId,
                format: encoding.format,
                bitrate: encoding.bitrate.toString(),
                size: encoding.size.toString(),
                createdAt: new Date().toISOString(),
                processingMode: "workflow-enhanced",
              },
            });

            const url = `${this.env.R2_ENDPOINT}/${key}`;
            console.log(`Stored encoding ${index + 1}: ${url}`);

            return {
              ...encoding,
              url,
              key,
            };
          }
        );

        // Store chunk files in R2 (for backup/archival)
        const chunkPromises = chunkingResult.chunks.map(
          async (chunk, index) => {
            // Note: chunks are now served via URLs from the container
            // We could optionally store them in R2 for archival purposes
            console.log(`Chunk ${index + 1} available at: ${chunk.url}`);
            return chunk;
          }
        );

        const [storedEncodings, storedChunks] = await Promise.all([
          Promise.all(encodingPromises),
          Promise.all(chunkPromises),
        ]);

        return {
          encodings: storedEncodings,
          chunks: storedChunks,
        };
      }
    );

    // Step 5: Update episode with encoded audio URLs
    await step.do(
      "update-episode-encodings",
      {
        retries: {
          limit: 2,
          delay: "5 seconds",
        },
        timeout: "5 minutes",
      },
      async () => {
        // Prepare encoded URLs for episode metadata
        const encodedAudioUrls = storageResult.encodings.reduce(
          (acc, encoding) => {
            const key = `${encoding.format}_${encoding.bitrate}kbps`;
            acc[key] = encoding.url;
            return acc;
          },
          {} as Record<string, string>
        );

        // Update episode with encoded audio metadata
        const episodeRepository = new EpisodeRepository(this.env.DB);

        await episodeRepository.updateByIdOnly(episodeId, {
          encodedAudioUrls: JSON.stringify(encodedAudioUrls),
        });

        console.log(
          `Episode ${episodeId} updated with ${
            Object.keys(encodedAudioUrls).length
          } encoded formats`
        );

        return { encodedAudioUrls };
      }
    );

    // Step 6: Transcribe chunks in parallel
    const transcribedChunks = await step.do(
      "transcribe-chunks",
      {
        retries: {
          limit: 2,
          delay: "10 seconds",
          backoff: "exponential",
        },
        timeout: "20 minutes",
      },
      async () => {
        console.log(
          `Starting parallel transcription of ${storageResult.chunks.length} chunks`
        );

        const transcribeChunk = async (
          chunk: AudioChunk
        ): Promise<TranscribedChunk> => {
          if (!chunk.url) {
            throw new Error(`Chunk ${chunk.index} missing URL`);
          }

          console.log(
            `Transcribing chunk ${chunk.index} (${chunk.startTime}s - ${chunk.endTime}s)`
          );

          const audioResponse = await fetch(chunk.url);
          if (!audioResponse.ok) {
            throw new Error(
              `Failed to fetch chunk ${chunk.index}: ${audioResponse.status}`
            );
          }

          const audioArrayBuffer = await audioResponse.arrayBuffer();

          const transcriptResponse = (await this.env.AI.run(
            "@cf/openai/whisper",
            {
              audio: [...new Uint8Array(audioArrayBuffer)],
            }
          )) as { text: string };

          if (!transcriptResponse || !transcriptResponse.text) {
            throw new Error(`Transcription failed for chunk ${chunk.index}`);
          }

          const transcriptText = transcriptResponse.text.trim();
          const wordCount = transcriptText
            .split(/\s+/)
            .filter((word) => word.length > 0).length;

          return {
            index: chunk.index,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            duration: chunk.duration,
            text: transcriptText,
            wordCount,
          };
        };

        // Process chunks in batches
        const concurrencyLimit = 3;
        const transcribed: TranscribedChunk[] = [];

        for (
          let i = 0;
          i < storageResult.chunks.length;
          i += concurrencyLimit
        ) {
          const batch = storageResult.chunks.slice(i, i + concurrencyLimit);
          const batchResults = await Promise.all(batch.map(transcribeChunk));
          transcribed.push(...batchResults);

          console.log(
            `Transcribed batch ${
              Math.floor(i / concurrencyLimit) + 1
            }/${Math.ceil(storageResult.chunks.length / concurrencyLimit)}`
          );
        }

        // Sort by index to ensure correct order
        transcribed.sort((a, b) => a.index - b.index);

        console.log(
          `Transcription completed: ${transcribed.length} chunks transcribed`
        );

        return transcribed;
      }
    );

    // Step 7: Cleanup temporary chunk files
    await step.do(
      "cleanup-chunk-files",
      {
        retries: {
          limit: 1,
          delay: "5 seconds",
        },
        timeout: "2 minutes",
      },
      async () => {
        console.log(
          `Cleaning up ${storageResult.chunks.length} temporary chunk files`
        );

        try {
          // Get a reference to the encoding container
          const containerId =
            this.env.ENCODING_CONTAINER.idFromName("encoding-service");
          const container = this.env.ENCODING_CONTAINER.get(containerId);

          // Extract chunk IDs from URLs or use chunk IDs directly
          const chunkIds = storageResult.chunks
            .map((chunk) => {
              if (chunk.chunkId) {
                return chunk.chunkId;
              }
              if (chunk.url) {
                const urlParts = chunk.url.split("/");
                const filename = urlParts[urlParts.length - 1];
                return filename.replace(/\.(mp3|aac)$/, "");
              }
              return null;
            })
            .filter((id) => id !== null);

          if (chunkIds.length > 0) {
            const cleanupResponse = await container.fetch(
              "http://localhost:8080/cleanup",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chunkIds: chunkIds,
                }),
              }
            );

            if (cleanupResponse.ok) {
              const cleanupResult = (await cleanupResponse.json()) as any;
              console.log(
                `Cleanup completed: ${
                  cleanupResult.results?.length || 0
                } files processed`
              );
            } else {
              console.warn("Cleanup request failed, but continuing...");
            }
          }
        } catch (error) {
          console.warn("Cleanup failed (non-critical):", error);
        }

        return { cleanedUp: true };
      }
    );

    // Step 8: Final processing and store transcript
    const finalResult = await step.do(
      "finalize-processing",
      {
        retries: {
          limit: 2,
          delay: "2 seconds",
        },
        timeout: "5 minutes",
      },
      async () => {
        console.log(`Finalizing audio processing for episode ${episodeId}`);

        // Merge transcriptions
        const mergedTranscript = this.mergeTranscriptions(
          transcribedChunks,
          overlapDuration
        );

        // Store transcript
        const transcriptId = uuidv4();
        const transcriptKey = `transcripts/${episodeId}/${transcriptId}.txt`;

        await this.env.BUCKET.put(transcriptKey, mergedTranscript.text, {
          httpMetadata: {
            contentType: "text/plain",
            contentLanguage: "en",
          },
          customMetadata: {
            episodeId,
            workflowId: workflowState.workflowId,
            createdAt: new Date().toISOString(),
            processingMode: "workflow-enhanced",
            totalChunks: transcribedChunks.length.toString(),
            totalEncodings: storageResult.encodings.length.toString(),
          },
        });

        const transcriptUrl = `${this.env.R2_ENDPOINT}/${transcriptKey}`;

        // Update episode with transcript
        const episodeRepository = new EpisodeRepository(this.env.DB);

        await episodeRepository.updateByIdOnly(episodeId, {
          transcriptUrl,
        });

        return {
          transcriptUrl,
          textLength: mergedTranscript.text.length,
          totalWords: mergedTranscript.totalWords,
          totalChunks: transcribedChunks.length,
          totalEncodings: storageResult.encodings.length,
        };
      }
    );

    return {
      success: true,
      episodeId,
      workflowId: workflowState.workflowId,
      ...finalResult,
    };
  }

  // Helper method for audio chunking
  private async processAudioChunking(
    container: DurableObjectStub,
    audioUrl: string,
    chunkDuration: number,
    overlapDuration: number
  ): Promise<{
    chunks: AudioChunk[];
    totalChunks: number;
    totalDuration: number;
  }> {
    const response = await container.fetch("http://localhost:8080/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioUrl,
        chunkDuration,
        overlapDuration,
        outputFormat: "mp3",
        bitrate: 32,
        streaming: false, // Use non-streaming mode for clean JSON response
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chunking failed: ${response.status} - ${errorText}`);
    }

    const chunkData = (await response.json()) as any;
    if (!chunkData.success) {
      throw new Error(`Chunking failed: ${chunkData.error}`);
    }

    return {
      chunks: chunkData.chunks,
      totalChunks: chunkData.totalChunks,
      totalDuration: chunkData.totalDuration,
    };
  }

  // Helper method for encoding different formats
  private async processEncodingFormats(
    container: DurableObjectStub,
    audioUrl: string,
    formats: string[]
  ): Promise<
    Array<{
      format: string;
      bitrate: number;
      encodedData: string;
      size: number;
      duration?: number;
    }>
  > {
    const encodingPromises = formats.map(async (format) => {
      const [codec, bitrateStr] = format.split("_");
      const bitrate = parseInt(bitrateStr);

      const response = await container.fetch("http://localhost:8080/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl,
          outputFormat: codec,
          bitrate,
          streaming: false, // Use non-streaming mode for clean JSON response
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
        encodedData: encodingData.encodedData,
        size: encodingData.metadata.size,
        duration: encodingData.metadata.duration,
      };
    });

    return Promise.all(encodingPromises);
  }

  // Helper method to merge transcriptions
  private mergeTranscriptions(
    chunks: TranscribedChunk[],
    overlapDuration: number
  ): { text: string; totalWords: number } {
    if (chunks.length === 0) return { text: "", totalWords: 0 };
    if (chunks.length === 1)
      return { text: chunks[0].text, totalWords: chunks[0].wordCount };

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
        const estimatedOverlapRatio = actualOverlap / currentChunk.duration;
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
}
