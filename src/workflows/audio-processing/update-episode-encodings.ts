import { EpisodeRepository } from "../../episodes/repository";
import type { Env, EncodingResult, WorkflowState } from "./types";

export async function updateEpisodeEncodings(
  env: Env,
  workflowState: WorkflowState,
  encodings: EncodingResult[]
): Promise<{ encodedAudioUrls: Record<string, string> }> {
  // Prepare encoded URLs for episode metadata
  const encodedAudioUrls = encodings.reduce(
    (acc: Record<string, string>, encoding) => {
      const key = `${encoding.format}_${encoding.bitrate}kbps`;
      const url = `${env.R2_ENDPOINT}/${encoding.r2Key}`;
      acc[key] = url;
      return acc;
    },
    {} as Record<string, string>
  );

  // Update episode with encoded audio metadata
  const episodeRepository = new EpisodeRepository(env.DB);

  await episodeRepository.updateByIdOnly(workflowState.episodeId, {
    encodedAudioUrls: JSON.stringify(encodedAudioUrls),
  });

  return { encodedAudioUrls };
}
