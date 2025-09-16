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

  // Store transcript as text file
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
      processingMode: "workflow-enhanced-words",
      totalChunks: transcribedChunks.length.toString(),
      totalEncodings: encodings.length.toString(),
      totalWords: mergedTranscript.totalWords.toString(),
    },
  });

  // Store word-level transcript as JSON file for future use
  const wordsKey = `transcripts/${workflowState.episodeId}/${transcriptId}-words.json`;
  const wordsData = {
    episodeId: workflowState.episodeId,
    workflowId: workflowState.workflowId,
    createdAt: new Date().toISOString(),
    totalWords: mergedTranscript.totalWords,
    words: mergedTranscript.words,
  };

  await env.BUCKET.put(wordsKey, JSON.stringify(wordsData, null, 2), {
    httpMetadata: {
      contentType: "application/json",
      contentLanguage: "en",
    },
    customMetadata: {
      episodeId: workflowState.episodeId,
      workflowId: workflowState.workflowId,
      dataType: "word-timestamps",
    },
  });

  const transcriptUrl = `${env.R2_ENDPOINT}/${transcriptKey}`;

  // Update episode with transcript (only if not already set by enhance-transcript step)
  const episodeRepository = new EpisodeRepository(env.DB);
  const existingEpisode = await episodeRepository.findByIdOnly(
    workflowState.episodeId
  );

  // Only update transcriptUrl if it hasn't been set by the enhance-transcript step
  if (
    !existingEpisode?.transcriptUrl ||
    !existingEpisode.transcriptUrl.includes("-enhanced.json")
  ) {
    await episodeRepository.updateByIdOnly(workflowState.episodeId, {
      transcriptUrl,
    });
  }

  return {
    transcriptUrl,
    textLength: mergedTranscript.text.length,
    totalWords: mergedTranscript.totalWords,
    totalChunks: transcribedChunks.length,
    totalEncodings: encodings.length,
  };
}
