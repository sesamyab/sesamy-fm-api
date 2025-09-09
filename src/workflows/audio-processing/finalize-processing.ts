import { v4 as uuidv4 } from "uuid";
import { EpisodeRepository } from "../../episodes/repository";
import { mergeTranscriptions } from "./utils";
import type {
  Env,
  WorkflowState,
  TranscribedChunk,
  EncodingResult,
} from "./types";

export async function finalizeProcessing(
  env: Env,
  workflowState: WorkflowState,
  transcribedChunks: TranscribedChunk[],
  encodings: EncodingResult[]
): Promise<{
  transcriptUrl: string;
  textLength: number;
  totalWords: number;
  totalChunks: number;
  totalEncodings: number;
}> {
  // Merge transcriptions
  const mergedTranscript = mergeTranscriptions(
    transcribedChunks,
    workflowState.overlapDuration
  );

  // Store transcript
  const transcriptId = uuidv4();
  const transcriptKey = `transcripts/${workflowState.episodeId}/${transcriptId}.txt`;

  await env.BUCKET.put(transcriptKey, mergedTranscript.text, {
    httpMetadata: {
      contentType: "text/plain",
      contentLanguage: "en",
    },
    customMetadata: {
      episodeId: workflowState.episodeId,
      workflowId: workflowState.workflowId,
      createdAt: new Date().toISOString(),
      processingMode: "workflow-enhanced",
      totalChunks: transcribedChunks.length.toString(),
      totalEncodings: encodings.length.toString(),
    },
  });

  const transcriptUrl = `${env.R2_ENDPOINT}/${transcriptKey}`;

  // Update episode with transcript
  const episodeRepository = new EpisodeRepository(env.DB);

  await episodeRepository.updateByIdOnly(workflowState.episodeId, {
    transcriptUrl,
  });

  return {
    transcriptUrl,
    textLength: mergedTranscript.text.length,
    totalWords: mergedTranscript.totalWords,
    totalChunks: transcribedChunks.length,
    totalEncodings: encodings.length,
  };
}
