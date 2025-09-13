import { z } from "zod";
import type {
  Env,
  ImportShowWorkflowState,
  RSSShow,
  ShowCreationResult,
} from "./types";
import { ShowRepository } from "../../shows/repository";
import { EpisodeRepository } from "../../episodes/repository";
import { EventPublisher } from "../../events/publisher";
import {
  fetchAndParseRSS,
  RSSParseError,
  RSSValidationError,
} from "./rss-parser";
import { v4 as uuidv4 } from "uuid";

// WorkflowStep interface
export interface WorkflowStep<TInput, TOutput> {
  validateInput(input: unknown): TInput;
  validateOutput(output: unknown): TOutput;
  execute(input: TInput): Promise<TOutput>;
}

// Schemas for RSS parsing step
const ParseRSSInputSchema = z.object({
  rssUrl: z.string().url(),
  maxEpisodes: z.number().int().positive(),
});

const ParseRSSOutputSchema = z.object({
  parsedRSS: z.object({
    title: z.string(),
    description: z.string(),
    imageUrl: z.string().nullable().optional(),
    language: z.string().optional(),
    categories: z.array(z.string()).optional(),
    author: z.string().optional(),
    episodes: z.array(z.any()),
  }),
  totalEpisodes: z.number().int().nonnegative(),
});

type ParseRSSInput = z.infer<typeof ParseRSSInputSchema>;
type ParseRSSOutput = z.infer<typeof ParseRSSOutputSchema>;

export class ValidateAndParseRSSStep
  implements WorkflowStep<ParseRSSInput, ParseRSSOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): ParseRSSInput {
    return ParseRSSInputSchema.parse(input);
  }

  validateOutput(output: unknown): ParseRSSOutput {
    return ParseRSSOutputSchema.parse(output);
  }

  async execute(input: ParseRSSInput): Promise<ParseRSSOutput> {
    const validInput = this.validateInput(input);

    try {
      console.log(`Fetching and parsing RSS from: ${validInput.rssUrl}`);

      const parsedRSS = await fetchAndParseRSS(validInput.rssUrl);

      const result = {
        parsedRSS,
        totalEpisodes: Math.min(
          parsedRSS.episodes.length,
          validInput.maxEpisodes
        ),
      };

      console.log(
        `Successfully parsed RSS: ${parsedRSS.title} with ${parsedRSS.episodes.length} episodes`
      );

      return this.validateOutput(result);
    } catch (error) {
      if (
        error instanceof RSSParseError ||
        error instanceof RSSValidationError
      ) {
        throw new Error(`RSS parsing failed: ${error.message}`);
      }
      throw new Error(
        `Unexpected error during RSS parsing: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

// Schemas for show creation step
const CreateShowInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable().optional(),
  language: z.string().optional(),
  categories: z.array(z.string()).optional(),
  author: z.string().optional(),
});

const CreateShowOutputSchema = z.object({
  showId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  categories: z.array(z.string()).nullable().optional(),
  author: z.string().nullable().optional(),
});

type CreateShowInput = z.infer<typeof CreateShowInputSchema>;
type CreateShowOutput = z.infer<typeof CreateShowOutputSchema>;

export class CreateShowStep
  implements WorkflowStep<CreateShowInput, CreateShowOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): CreateShowInput {
    return CreateShowInputSchema.parse(input);
  }

  validateOutput(output: unknown): CreateShowOutput {
    return CreateShowOutputSchema.parse(output);
  }

  async execute(input: CreateShowInput): Promise<CreateShowOutput> {
    const validInput = this.validateInput(input);

    try {
      console.log(`Creating show: ${validInput.title}`);

      const showRepository = new ShowRepository(this.env.DB);
      const eventPublisher = new EventPublisher();

      const showId = uuidv4();
      const now = new Date().toISOString();

      // Download and upload show image if provided
      let processedImageUrl = validInput.imageUrl;
      if (validInput.imageUrl && this.env.BUCKET) {
        try {
          console.log(`Downloading show image from: ${validInput.imageUrl}`);

          const imageResponse = await fetch(validInput.imageUrl, {
            headers: {
              "User-Agent": "Sesamy Podcast Importer/1.0",
            },
            signal: AbortSignal.timeout(15000), // 15 second timeout
          });

          if (imageResponse.ok) {
            const imageBuffer = await imageResponse.arrayBuffer();
            const imageBlob = new Uint8Array(imageBuffer);

            // Generate R2 key for the image
            const imageFileName = `show-${showId}-${Date.now()}.jpg`;
            const imageR2Key = `shows/${showId}/${imageFileName}`;

            await this.env.BUCKET.put(imageR2Key, imageBlob, {
              httpMetadata: {
                contentType:
                  imageResponse.headers.get("content-type") || "image/jpeg",
              },
            });

            processedImageUrl = `r2://${imageR2Key}`;
            console.log(`Show image uploaded to R2: ${imageR2Key}`);
          } else {
            console.warn(
              `Failed to download show image: ${imageResponse.status}`
            );
          }
        } catch (error) {
          console.error("Failed to download/upload show image:", error);
          // Continue with original URL if download fails
        }
      }

      // Create the show
      const show = await showRepository.create({
        id: showId,
        title: validInput.title,
        description: validInput.description,
        imageUrl: processedImageUrl,
        language: validInput.language,
        categories: validInput.categories,
        author: validInput.author,
      });

      // Publish event
      await eventPublisher.publish("show.created", show, show.id);

      const result: CreateShowOutput = {
        showId: show.id,
        title: show.title,
        description: show.description,
        imageUrl: show.imageUrl,
        language: show.language || null,
        categories: show.categories || null,
        author: show.author || null,
      };

      console.log(`Successfully created show with ID: ${show.id}`);

      return this.validateOutput(result);
    } catch (error) {
      throw new Error(
        `Failed to create show: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

// Schemas for episode processing step
const ProcessEpisodeInputSchema = z.object({
  showId: z.string().uuid(),
  episode: z.object({
    title: z.string(),
    description: z.string(),
    audioUrl: z.string().url(),
    imageUrl: z.string().nullable().optional(),
    publishedAt: z.string().datetime().nullable().optional(),
    duration: z.number().positive().nullable().optional(),
    episodeNumber: z.number().int().nonnegative().nullable().optional(),
    seasonNumber: z.number().int().nonnegative().nullable().optional(),
    episodeType: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    subtitle: z.string().nullable().optional(),
    explicit: z.boolean().nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
  }),
  skipExisting: z.boolean().optional().default(false),
});

const ProcessEpisodeOutputSchema = z.object({
  episodeId: z.string().uuid(),
  title: z.string(),
  status: z.enum(["created", "skipped"]),
  audioR2Key: z.string().optional(),
  audioProcessingTaskId: z.string().optional(),
});

type ProcessEpisodeInput = z.infer<typeof ProcessEpisodeInputSchema>;
type ProcessEpisodeOutput = z.infer<typeof ProcessEpisodeOutputSchema>;

export class ProcessEpisodeStep
  implements WorkflowStep<ProcessEpisodeInput, ProcessEpisodeOutput>
{
  constructor(private env: Env) {}

  validateInput(input: unknown): ProcessEpisodeInput {
    return ProcessEpisodeInputSchema.parse(input);
  }

  validateOutput(output: unknown): ProcessEpisodeOutput {
    return ProcessEpisodeOutputSchema.parse(output);
  }

  async execute(input: ProcessEpisodeInput): Promise<ProcessEpisodeOutput> {
    const validInput = this.validateInput(input);

    try {
      console.log(`Processing episode: ${validInput.episode.title}`);

      const episodeRepository = new EpisodeRepository(this.env.DB);
      const eventPublisher = new EventPublisher();

      const episodeId = uuidv4();
      const now = new Date().toISOString();

      // Download and upload episode image if provided
      let processedImageUrl = validInput.episode.imageUrl;
      if (validInput.episode.imageUrl && this.env.BUCKET) {
        try {
          console.log(
            `Downloading episode image from: ${validInput.episode.imageUrl}`
          );

          const imageResponse = await fetch(validInput.episode.imageUrl, {
            headers: {
              "User-Agent": "Sesamy Podcast Importer/1.0",
            },
            signal: AbortSignal.timeout(15000), // 15 second timeout
          });

          if (imageResponse.ok) {
            const imageBuffer = await imageResponse.arrayBuffer();
            const imageBlob = new Uint8Array(imageBuffer);

            // Generate R2 key for the image
            const imageFileName = `episode-${episodeId}-${Date.now()}.jpg`;
            const imageR2Key = `episodes/${validInput.showId}/${imageFileName}`;

            await this.env.BUCKET.put(imageR2Key, imageBlob, {
              httpMetadata: {
                contentType:
                  imageResponse.headers.get("content-type") || "image/jpeg",
              },
            });

            processedImageUrl = `r2://${imageR2Key}`;
            console.log(`Episode image uploaded to R2: ${imageR2Key}`);
          } else {
            console.warn(
              `Failed to download episode image: ${imageResponse.status}`
            );
          }
        } catch (error) {
          console.error("Failed to download/upload episode image:", error);
          // Continue with original URL if download fails
        }
      }

      // Create the episode
      const episode = await episodeRepository.create(validInput.showId, {
        id: episodeId,
        title: validInput.episode.title,
        description: validInput.episode.description,
        imageUrl: processedImageUrl,
        audioUrl: null, // Will be set after audio processing
        transcriptUrl: null,
        duration: validInput.episode.duration || null,
        episodeNumber: validInput.episode.episodeNumber || null,
        seasonNumber: validInput.episode.seasonNumber || null,
        episodeType: validInput.episode.episodeType || null,
        author: validInput.episode.author || null,
        subtitle: validInput.episode.subtitle || null,
        explicit: validInput.episode.explicit || null,
        keywords: validInput.episode.keywords
          ? JSON.stringify(validInput.episode.keywords)
          : null,
      });

      // Publish event
      await eventPublisher.publish("episode.created", episode, episode.id);

      // Download audio file and upload to R2 storage
      let audioR2Key: string | undefined;
      let audioProcessingTaskId: string | undefined;

      try {
        console.log(`Downloading audio from: ${validInput.episode.audioUrl}`);

        // Download the audio file
        const audioResponse = await fetch(validInput.episode.audioUrl, {
          headers: {
            "User-Agent": "Sesamy Podcast Importer/1.0",
          },
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!audioResponse.ok) {
          throw new Error(
            `Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`
          );
        }

        const audioBuffer = await audioResponse.arrayBuffer();
        const audioBlob = new Uint8Array(audioBuffer);

        // Generate R2 key for the audio file
        const audioFileName = `episode-${episode.id}-${Date.now()}.mp3`;
        audioR2Key = `episodes/${validInput.showId}/${audioFileName}`;

        // Upload to R2 storage
        if (this.env.BUCKET) {
          await this.env.BUCKET.put(audioR2Key, audioBlob, {
            httpMetadata: {
              contentType:
                audioResponse.headers.get("content-type") || "audio/mpeg",
            },
          });

          // Update episode with R2 audio URL
          await episodeRepository.updateByIdOnly(episode.id, {
            audioUrl: `r2://${audioR2Key}`,
          });

          console.log(`Audio uploaded to R2: ${audioR2Key}`);

          // Trigger audio processing workflow
          if (this.env.AUDIO_PROCESSING_WORKFLOW) {
            try {
              console.log(
                `Triggering audio processing workflow for episode ${episode.id}`
              );

              const audioProcessingParams = {
                episodeId: episode.id,
                audioR2Key,
                chunkDuration: 30,
                transcriptionLanguage: "auto", // Auto-detect language
              };

              const audioWorkflowInstance =
                await this.env.AUDIO_PROCESSING_WORKFLOW.create({
                  params: audioProcessingParams,
                });

              audioProcessingTaskId = audioWorkflowInstance.id;
              console.log(
                `Audio processing workflow started: ${audioWorkflowInstance.id}`
              );
            } catch (error) {
              console.error(
                `Failed to start audio processing workflow for episode ${episode.id}:`,
                error
              );
            }
          } else {
            console.warn(
              "AUDIO_PROCESSING_WORKFLOW not available, skipping audio processing"
            );
          }
        } else {
          console.warn("BUCKET not available, skipping audio upload");
        }
      } catch (error) {
        console.error(
          `Failed to download/process audio for episode ${episode.id}:`,
          error
        );
        // Don't fail the entire episode creation, just log the error
      }

      const result: ProcessEpisodeOutput = {
        episodeId: episode.id,
        title: episode.title,
        status: "created" as const,
        audioR2Key,
        audioProcessingTaskId,
      };

      console.log(`Successfully created episode with ID: ${episode.id}`);

      return this.validateOutput(result);
    } catch (error) {
      throw new Error(
        `Failed to process episode: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
