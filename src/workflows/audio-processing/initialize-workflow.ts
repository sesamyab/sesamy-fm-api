import { v4 as uuidv4 } from "uuid";
import { generateSignedDownloadUrl } from "../../utils/storage";
import type { Env, AudioProcessingParams, WorkflowState } from "./types";

export async function initializeWorkflow(
  env: Env,
  params: AudioProcessingParams
): Promise<WorkflowState> {
  const {
    episodeId,
    audioR2Key,
    chunkDuration = 30,
    overlapDuration = 2,
    encodingFormats = ["mp3_128"],
    taskId,
    transcriptionLanguage = "en",
  } = params;

  if (!episodeId || !audioR2Key) {
    throw new Error("Episode ID and audio R2 key are required");
  }

  const workflowId = uuidv4();
  const timestamp = new Date().toISOString();

  // Strip r2:// prefix if present to get the actual R2 key for URL generation
  const actualR2Key = audioR2Key.startsWith("r2://")
    ? audioR2Key.substring(5)
    : audioR2Key;

  // Generate a preview of the download URL that will be used in the next step
  const previewDownloadUrl = await generateSignedDownloadUrl(
    env,
    actualR2Key,
    3600
  );

  return {
    workflowId,
    episodeId,
    audioR2Key,
    chunkDuration,
    overlapDuration,
    encodingFormats,
    startedAt: timestamp,
    taskId,
    transcriptionLanguage,
    previewDownloadUrl: previewDownloadUrl.url,
  };
}
