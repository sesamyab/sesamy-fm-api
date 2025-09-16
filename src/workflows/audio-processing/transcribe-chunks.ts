import type {
  Env,
  ChunkingResult,
  WorkflowState,
  TranscribedChunk,
  Nova3Response,
} from "./types";
import { Nova3ResponseSchema } from "./types";
import { generateSignedDownloadUrl } from "../../utils/storage.js";

interface TranscriptionOptions {
  audio: any;
  [key: string]: any;
}

interface ChunkTranscription {
  chunkStartOffset: number;
  chunkIndex: number;
  transcript: any;
}

interface TranscriptionResult {
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  language?: string;
  sentiments?: any[];
  summary?: string;
  speakers?: any[];
  keywords?: any[];
  paragraphs?: any[];
  chapters?: any[];
  results?: any; // For Deepgram response format
}

async function fetchAudioData(
  audioUrl: string
): Promise<{ response: Response; arrayBuffer?: ArrayBuffer }> {
  const response = await fetch(audioUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch from audio URL: ${response.status} ${response.statusText}`
    );
  }

  return { response };
}

async function transcribeWithWhisper(
  env: Env,
  workflowState: WorkflowState,
  audioUrl: string,
  chunkIndex: number
): Promise<TranscribedChunk | null> {
  const defaultLanguage = env.DEFAULT_TRANSCRIPTION_LANGUAGE || "en";
  const language = workflowState.transcriptionLanguage || defaultLanguage;

  const { response } = await fetchAudioData(audioUrl);
  const audioArrayBuffer = await response.arrayBuffer();

  const transcriptionOptions: TranscriptionOptions = {
    audio: Array.from(new Uint8Array(audioArrayBuffer)),
    language: language,
  };

  const transcriptResponse = (await env.AI.run(
    workflowState.transcriptionModel as any,
    transcriptionOptions
  )) as TranscriptionResult;

  // TODO: this is not true..
  return transcriptResponse as TranscribedChunk;
}

async function transcribeWithDeepgram(
  env: Env,
  workflowState: WorkflowState,
  audioUrl: string,
  chunkIndex: number
) {
  const chunkStartOffset = chunkIndex * workflowState.chunkDuration;

  const { response } = await fetchAudioData(audioUrl);

  const transcriptionOptions: TranscriptionOptions = {
    audio: {
      body: response.body,
      contentType: "audio/mpeg",
    },
  };

  // Enable Nova-3 specific features if configured
  if (workflowState.useNova3Features) {
    transcriptionOptions.punctuate = true;
    transcriptionOptions.smart_format = true;
    transcriptionOptions.numerals = true;
    transcriptionOptions.dictation = true;
    transcriptionOptions.diarize = true;
    transcriptionOptions.detectLanguage = true;
  }

  const transcriptResponse = await env.AI.run(
    workflowState.transcriptionModel as any,
    transcriptionOptions
  );

  if (!transcriptResponse || Object.keys(transcriptResponse).length === 0) {
    console.warn(`Deepgram returned empty response for chunk ${chunkIndex}`);
    return null;
  }

  // Fallback for other models
  return Nova3ResponseSchema.parse(transcriptResponse);
}

export async function transcribeChunks(
  env: Env,
  workflowState: WorkflowState,
  chunkingResult: ChunkingResult
): Promise<{
  transcribedChunks: TranscribedChunk[];
  chunkTranscriptionsUrl?: string;
}> {
  // Validate chunks data before processing
  if (chunkingResult.chunks.length === 0) {
    throw new Error(
      `No chunks available for transcription. [Settings: language=${
        workflowState.transcriptionLanguage ||
        env.DEFAULT_TRANSCRIPTION_LANGUAGE ||
        "en"
      }, model=${workflowState.transcriptionModel}, nova3=${
        workflowState.useNova3Features
      }]`
    );
  }

  // Track errors for detailed reporting
  const chunkErrors: Array<{ index: number; error: string }> = [];

  // Store all transcriptions for JSON output
  const allTranscriptions: ChunkTranscription[] = [];

  const transcribeChunk = async (audioUrl: string, index: number) => {
    if (!audioUrl) {
      const error = `No audio URL available for chunk ${index}`;
      console.warn(error);
      chunkErrors.push({ index, error });
      return null;
    }

    try {
      const chunkStartOffset = index * workflowState.chunkDuration;
      let transcriptResult;

      switch (workflowState.transcriptionModel) {
        case "@cf/deepgram/nova-3":
          transcriptResult = await transcribeWithDeepgram(
            env,
            workflowState,
            audioUrl,
            index
          );
          break;
        case "@cf/openai/whisper":
          transcriptResult = await transcribeWithWhisper(
            env,
            workflowState,
            audioUrl,
            index
          );
          break;
        default:
          throw new Error(
            `Unsupported transcription model: ${workflowState.transcriptionModel}. Supported models: deepgram/nova-*, @cf/openai/whisper-*`
          );
      }

      // Store the transcription data for JSON output
      if (transcriptResult) {
        allTranscriptions.push({
          chunkStartOffset,
          chunkIndex: index,
          transcript: transcriptResult,
        });
      }

      return transcriptResult;
    } catch (error) {
      const errorMsg = `Transcription failed for chunk ${index}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.warn(errorMsg);
      chunkErrors.push({ index, error: errorMsg });
      return null;
    }
  };

  // Process chunks in batches
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

  // Store transcriptions JSON to R2
  let chunkTranscriptionsUrl: string | undefined;

  if (allTranscriptions.length > 0) {
    try {
      const transcriptionsJson = JSON.stringify(allTranscriptions, null, 2);
      const r2Key = `transcriptions/${workflowState.episodeId}/${workflowState.workflowId}/chunk-transcriptions.json`;

      // Upload to R2
      await env.BUCKET.put(r2Key, transcriptionsJson, {
        httpMetadata: {
          contentType: "application/json",
        },
      });

      // Generate signed download URL
      const signedUrl = await generateSignedDownloadUrl(
        env,
        r2Key,
        3600 * 24 // 24 hours expiration
      );

      chunkTranscriptionsUrl = signedUrl.url;

      console.log(
        `Stored ${allTranscriptions.length} chunk transcriptions to R2: ${r2Key}`
      );
      console.log(`Signed URL: ${chunkTranscriptionsUrl}`);
    } catch (error) {
      console.error("Failed to store transcriptions JSON to R2:", error);
      // Don't fail the entire workflow if JSON storage fails
    }
  }

  // Ensure we have at least some transcribed chunks
  if (transcribed.length === 0) {
    const errorDetails = chunkErrors
      .map(({ index, error }) => `Chunk ${index}: ${error}`)
      .join("; ");

    const detailedError = `All ${chunkingResult.chunks.length} chunks failed transcription. Cannot proceed without any transcribed content. Model: ${workflowState.transcriptionModel}. Errors: ${errorDetails}`;

    throw new Error(detailedError);
  }

  return {
    transcribedChunks: transcribed,
    chunkTranscriptionsUrl,
  };
}
