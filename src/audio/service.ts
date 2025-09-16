import { v4 as uuidv4 } from "uuid";
import { AudioRepository } from "./repository";
import { EventPublisher } from "../events/publisher";
import { EpisodeRepository } from "../episodes/repository";
import { NotFoundError } from "../common/errors";
import { R2PreSignedUrlGenerator } from "../utils";

export class AudioService {
  private audioRepo: AudioRepository;
  private eventPublisher: EventPublisher;
  private episodeRepo: EpisodeRepository;
  private audioProcessingWorkflow?: Workflow;
  private bucket: R2Bucket;
  private presignedUrlGenerator: R2PreSignedUrlGenerator | null = null;
  private database?: D1Database;

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    eventPublisher?: EventPublisher,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string,
    audioProcessingWorkflow?: Workflow
  ) {
    this.database = database;
    this.audioRepo = new AudioRepository(database);
    this.episodeRepo = new EpisodeRepository(database);
    this.eventPublisher = eventPublisher || new EventPublisher();
    this.audioProcessingWorkflow = audioProcessingWorkflow;
    this.bucket = bucket as R2Bucket;

    console.log(
      `AudioService initialized with workflow: ${!!audioProcessingWorkflow}`
    );

    // Initialize pre-signed URL generator if credentials are available
    if (r2AccessKeyId && r2SecretAccessKey) {
      console.log(
        `Initializing R2PreSignedUrlGenerator with endpoint: ${r2Endpoint}`
      );
      this.presignedUrlGenerator = new R2PreSignedUrlGenerator(
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
    } else {
      console.log(
        `R2 credentials not available - r2AccessKeyId: ${!!r2AccessKeyId}, r2SecretAccessKey: ${!!r2SecretAccessKey}`
      );
    }
  }

  async uploadAudio(
    showId: string,
    episodeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    // Verify episode exists
    const episode = await this.episodeRepo.findById(showId, episodeId);
    if (!episode) {
      throw new NotFoundError("Episode not found");
    }

    const audioId = uuidv4();
    const fileName = file.fileName;
    const key = `audio/${showId}/${episodeId}/${audioId}/${fileName}`;

    let url: string;
    let signedUrl: string;

    if (this.bucket) {
      // Upload to R2 bucket
      await this.bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.mimeType,
        },
      });

      // Store the R2 key with a special prefix for database storage
      url = `r2://${key}`;

      // Generate URL for immediate use and episode update
      if (this.presignedUrlGenerator) {
        try {
          // Use direct URL with custom domain if available
          const directUrl = this.presignedUrlGenerator.generateDirectUrl(
            "podcast-service-assets",
            key
          );
          signedUrl = directUrl || url; // Fall back to r2:// URL if no custom domain
        } catch (error) {
          console.warn("Failed to generate URL, using r2:// fallback:", error);
          signedUrl = url;
        }
      } else {
        console.warn("No R2 credentials available for URL generation");
        signedUrl = url;
      }
    } else {
      // Fallback for development/testing
      url = `https://storage.example.com/audio/${audioId}/${fileName}`;
      signedUrl = url;
    }

    // Save audio metadata with R2 key
    let audioUpload;
    try {
      console.log(`Creating audio record for episode ${episodeId}`);
      audioUpload = await this.audioRepo.create({
        id: audioId,
        episodeId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        url, // Store R2 key (r2://) for regenerating signed URLs
      });
      console.log(`Audio record created successfully: ${audioUpload.id}`);
    } catch (error) {
      console.error("Failed to create audio record:", error);
      throw new Error(
        `Database error: Failed to create audio record - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Update episode with R2 key (NOT signed URL)
    try {
      console.log(`Updating episode ${episodeId} with audio URL`);
      await this.episodeRepo.update(showId, episodeId, {
        audioUrl: url, // Store R2 key, sign on-demand when reading
      });
      console.log(`Episode updated successfully`);
    } catch (error) {
      console.error("Failed to update episode:", error);
      throw new Error(
        `Database error: Failed to update episode - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Publish event with R2 key (generate signed URL for event payload)
    try {
      console.log(`Publishing audio.uploaded event`);
      await this.eventPublisher.publish(
        "audio.uploaded",
        {
          ...audioUpload,
          url: signedUrl, // Include signed URL in event for immediate use
        },
        audioUpload.id
      );
      console.log(`Event published successfully`);
    } catch (error) {
      console.error("Failed to publish event:", error);
      throw new Error(
        `Event error: Failed to publish audio.uploaded event - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Process uploaded audio with workflow or fallback to tasks
    try {
      console.log(`Starting audio processing workflow`);
      await this.processUploadedAudio(episodeId, url, 600); // Pass R2 key and 10-minute chunks for nova-3
      console.log(`Audio processing workflow started successfully`);
    } catch (error) {
      console.error("Failed to start audio processing:", error);
      throw new Error(
        `Workflow error: Failed to start audio processing - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Return upload info with signed URL for immediate use
    return {
      ...audioUpload,
      url: signedUrl,
    };
  }

  // Process uploaded audio by creating a task that will start the workflow
  private async processUploadedAudio(
    episodeId: string,
    audioR2Key: string, // Changed parameter name to be clearer
    chunkDuration: number = 600 // Default to 10 minutes for nova-3
  ): Promise<void> {
    console.log(
      `Creating audio processing task for uploaded audio: episodeId=${episodeId}`
    );

    try {
      // Get the episode to find the show ID
      const episode = await this.episodeRepo.findByIdOnly(episodeId);
      if (!episode) {
        throw new Error(`Episode ${episodeId} not found`);
      }

      // Get the show to determine the language
      const { ShowRepository } = await import("../shows/repository.js");
      const showRepo = new ShowRepository(this.database);
      const show = await showRepo.findById(episode.showId);

      // Use show language if available, otherwise fall back to environment variable or "en"
      const transcriptionLanguage =
        show?.language || process.env.DEFAULT_TRANSCRIPTION_LANGUAGE || "en";

      console.log(
        `Using transcription language: ${transcriptionLanguage} for show ${episode.showId}`
      );

      // Import TaskService dynamically to avoid circular dependencies
      const { TaskService } = await import("../tasks/service.js");

      // Create a TaskService instance with workflow support
      console.log(
        `Creating TaskService with workflow: ${!!this.audioProcessingWorkflow}`
      );
      const taskService = new TaskService(
        this.database,
        this.audioProcessingWorkflow
      );

      // Create an audio_processing task with the required payload
      const task = await taskService.createTask("audio_processing", {
        episodeId,
        audioR2Key, // Use R2 key instead of signed URL
        chunkDuration,
        encodingFormats: ["mp3_128"], // Use MP3 format with auto-adjusted bitrate based on mono/stereo
        transcriptionLanguage,
      });

      console.log(
        `Created audio processing task ${task.id} for episode ${episodeId}`
      );

      // Generate signed URL for event payload (events may need accessible URLs)
      let eventSignedUrl = audioR2Key;
      if (this.presignedUrlGenerator && audioR2Key.startsWith("r2://")) {
        try {
          eventSignedUrl =
            await this.presignedUrlGenerator.generatePresignedUrl(
              audioR2Key.replace("r2://", ""),
              "get",
              3600 // 1 hour
            );
        } catch (error) {
          console.warn(
            "Failed to generate signed URL for event payload:",
            error
          );
        }
      }

      // Publish task created event (reusing existing workflow event type)
      console.log(`Publishing workflow started event for episode ${episodeId}`);
      await this.eventPublisher.publish(
        "episode.audio_processing_workflow_started",
        {
          episodeId,
          taskId: task.id,
          audioUrl: eventSignedUrl,
          audioR2Key, // Include R2 key for workflow consumers
          type: "task",
          message: "Audio processing task created and workflow started",
        },
        episodeId
      );
      console.log(`Workflow started event published successfully`);
    } catch (error) {
      console.error(
        `Failed to create audio processing task for episode ${episodeId}:`,
        error
      );
      throw new Error(
        `Task creation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getAudioMetadata(showId: string, episodeId: string) {
    const audioData = await this.audioRepo.findByEpisodeId(showId, episodeId);

    if (!audioData) {
      return null;
    }

    // Generate fresh pre-signed URL if we have the generator and URL contains an R2 key
    if (this.presignedUrlGenerator && audioData.url.startsWith("r2://")) {
      const key = audioData.url.replace("r2://", "");
      try {
        const signedUrl = await this.presignedUrlGenerator.generatePresignedUrl(
          "podcast-service-assets",
          key,
          28800 // 8 hours
        );

        return {
          ...audioData,
          url: signedUrl,
        };
      } catch (error) {
        console.warn("Failed to generate fresh pre-signed URL:", error);
      }
    }

    return audioData;
  }

  async getR2Object(key: string): Promise<R2Object | null> {
    if (!this.bucket) {
      throw new Error("R2 bucket not available");
    }

    try {
      const object = await this.bucket.get(key);
      return object;
    } catch (error) {
      console.error("Error getting R2 object:", error);
      return null;
    }
  }

  // Utility method to generate signed URL from R2 key
  async generateSignedUrlFromKey(r2Key: string): Promise<string | null> {
    if (!this.presignedUrlGenerator) {
      return null;
    }

    try {
      // Use direct URL with custom domain if available
      // Returns null if no custom domain is configured (avoiding broken cloudflarestorage.com URLs)
      return this.presignedUrlGenerator.generateDirectUrl(
        "podcast-service-assets",
        r2Key
      );
    } catch (error) {
      console.warn("Failed to generate URL for key:", r2Key, error);
      return null;
    }
  }

  async generatePresignedUrlFromKey(r2Key: string): Promise<string | null> {
    if (!this.presignedUrlGenerator) {
      return null;
    }

    try {
      // Use presigned URL for container/server-to-server access
      return await this.presignedUrlGenerator.generatePresignedUrl(
        "podcast-service-assets",
        r2Key,
        28800 // 8 hours
      );
    } catch (error) {
      console.warn("Failed to generate presigned URL for key:", r2Key, error);
      return null;
    }
  }

  /**
   * Creates an audio processing task that will start a workflow
   * This is the new recommended way to process audio
   */
  async createAudioProcessingTask(
    episodeId: string,
    audioR2Key: string,
    options?: {
      encodingFormats?: string[];
    }
  ) {
    // Get the episode to find the show ID
    const episode = await this.episodeRepo.findByIdOnly(episodeId);
    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    // Get the show to determine the language
    const { ShowRepository } = await import("../shows/repository.js");
    const showRepo = new ShowRepository(this.database);
    const show = await showRepo.findById(episode.showId);

    // Use show language if available, otherwise fall back to environment variable or "en"
    const transcriptionLanguage =
      show?.language || process.env.DEFAULT_TRANSCRIPTION_LANGUAGE || "en";

    console.log(
      `Using transcription language: ${transcriptionLanguage} for show ${episode.showId}`
    );

    // Import TaskService to create the task
    const { TaskService } = await import("../tasks/service.js");

    // Create a temporary TaskService instance with workflow support
    // In a real implementation, this should be injected as a dependency
    const taskService = new TaskService(
      this.database,
      this.audioProcessingWorkflow
    );

    // Get transcription model from environment or default to nova-3
    const transcriptionModel =
      process.env.DEFAULT_TRANSCRIPTION_MODEL || "@cf/deepgram/nova-3";

    // Set chunk duration based on model: 30 seconds for whisper, 10 minutes for nova-3
    const defaultChunkDuration = transcriptionModel.includes("whisper")
      ? 30
      : 600;

    const payload = {
      episodeId,
      audioR2Key,
      chunkDuration: defaultChunkDuration,
      encodingFormats: options?.encodingFormats || ["mp3_128"],
      transcriptionModel,
      useNova3Features: transcriptionModel.includes("nova"),
      transcriptionLanguage,
    };

    // Create an audio_processing task
    const task = await taskService.createTask("audio_processing", payload);

    console.log(
      `Created audio processing task ${task.id} for episode ${episodeId} using ${transcriptionModel} (${payload.chunkDuration}s chunks) with language ${transcriptionLanguage}`
    );

    return task;
  }
}
