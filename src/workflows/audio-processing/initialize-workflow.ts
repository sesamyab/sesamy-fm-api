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
      chunkDuration = 30,
      overlapDuration = 2,
      encodingFormats = ["mp3_128"],
      taskId,
      transcriptionLanguage = "en",
    } = validInput;

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
      this.env,
      actualR2Key,
      3600
    );

    const result = {
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
