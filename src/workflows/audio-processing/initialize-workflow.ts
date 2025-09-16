import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { generateSignedDownloadUrl } from "../../utils/storage";
import type {
  Env,
  AudioProcessingParams,
  WorkflowState,
  WorkflowStep,
} from "./types";
import { AudioProcessingParamsSchema, WorkflowStateSchema } from "./types";

// Input/Output schemas for this step
const InitializeInputSchema = AudioProcessingParamsSchema;
const InitializeOutputSchema = WorkflowStateSchema.extend({
  signedUrls: z.array(z.string().url()).optional(),
});

type InitializeInput = z.infer<typeof InitializeInputSchema>;
type InitializeOutput = z.infer<typeof InitializeOutputSchema>;

export class InitializeWorkflowStep
  implements WorkflowStep<InitializeInput, InitializeOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): InitializeInput {
    return InitializeInputSchema.parse(input);
  }

  validateOutput(output: unknown): InitializeOutput {
    return InitializeOutputSchema.parse(output);
  }

  async execute(input: InitializeInput): Promise<InitializeOutput> {
    const validInput = this.validateInput(input);

    const {
      episodeId,
      audioR2Key,
      chunkDuration = 60,
      overlapDuration = 2,
      encodingFormats = ["mp3_128"],
      taskId,
      transcriptionLanguage = this.env.DEFAULT_TRANSCRIPTION_LANGUAGE || "en",
      transcriptionModel = this.env.DEFAULT_TRANSCRIPTION_MODEL ||
        "@cf/deepgram/nova-3",
      useNova3Features = this.env.USE_NOVA3_FEATURES === "true" || false,
    } = validInput;

    if (!episodeId || !audioR2Key) {
      throw new Error(
        `Episode ID and audio R2 key are required [Settings: episodeId=${episodeId}, audioR2Key=${
          audioR2Key ? "provided" : "missing"
        }, transcriptionLanguage=${transcriptionLanguage}, transcriptionModel=${transcriptionModel}]`
      );
    }

    // Determine if we're using nova-3 and adjust settings accordingly
    const isNova3 =
      transcriptionModel === "@cf/deepgram/nova-3" || useNova3Features;
    const finalChunkDuration = isNova3 ? 600 : chunkDuration; // 10 minutes (600 seconds) for nova-3
    const finalOverlapDuration = isNova3 ? 30 : overlapDuration; // Longer overlap for 10-minute chunks
    const finalTranscriptionModel = isNova3
      ? "@cf/deepgram/nova-3"
      : transcriptionModel;

    const workflowId = uuidv4();
    const timestamp = new Date().toISOString();

    // Strip r2:// prefix if present to get the actual R2 key for URL generation
    const actualR2Key = audioR2Key.startsWith("r2://")
      ? audioR2Key.substring(5)
      : audioR2Key;

    // Generate a preview of the download URL that will be used in the next step
    const previewDownloadUrl = await generateSignedDownloadUrl(
      this.env,
      actualR2Key,
      3600
    );

    const result = {
      workflowId,
      episodeId,
      audioR2Key,
      chunkDuration: finalChunkDuration,
      overlapDuration: finalOverlapDuration,
      encodingFormats,
      startedAt: timestamp,
      taskId,
      transcriptionLanguage,
      transcriptionModel: finalTranscriptionModel,
      useNova3Features: isNova3,
      previewDownloadUrl: previewDownloadUrl.url,
      signedUrls: [previewDownloadUrl.url],
    };

    return this.validateOutput(result);
  }
}

// Legacy function for backward compatibility
export async function initializeWorkflow(
  env: Env,
  params: AudioProcessingParams
): Promise<WorkflowState> {
  const step = new InitializeWorkflowStep(env);
  const result = await step.execute(params);
  // Remove signedUrls for legacy compatibility
  const { signedUrls, ...legacyResult } = result;
  return legacyResult;
}
