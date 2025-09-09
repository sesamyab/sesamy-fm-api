import { processEncodingFormats } from "./utils";
import type { Env, EncodingResult, WorkflowState } from "./types";

export async function audioEncoding(
  env: Env,
  workflowState: WorkflowState
): Promise<{ encodings: EncodingResult[] }> {
  // Get a reference to the encoding container
  const containerId = env.ENCODING_CONTAINER.idFromName("encoding-service");
  const container = env.ENCODING_CONTAINER.get(containerId);

  // Process encoding for different formats
  const encodingResults = await processEncodingFormats(
    env,
    container,
    workflowState.audioR2Key,
    workflowState.encodingFormats,
    workflowState.episodeId
  );

  return {
    encodings: encodingResults,
  };
}
