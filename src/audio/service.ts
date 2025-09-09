/// <reference types="@cloudflare/workers-types" />

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

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    eventPublisher?: EventPublisher,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string,
    audioProcessingWorkflow?: Workflow
  ) {
    this.audioRepo = new AudioRepository(database);
    this.episodeRepo = new EpisodeRepository(database);
    this.eventPublisher = eventPublisher || new EventPublisher();
    this.audioProcessingWorkflow = audioProcessingWorkflow;
    this.bucket = bucket as R2Bucket;

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
    const audioUpload = await this.audioRepo.create({
      id: audioId,
      episodeId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url, // Store R2 key (r2://) for regenerating signed URLs
    });

    // Update episode with R2 key (NOT signed URL)
    await this.episodeRepo.update(showId, episodeId, {
      audioUrl: url, // Store R2 key, sign on-demand when reading
    });

    // Publish event with R2 key (generate signed URL for event payload)
    await this.eventPublisher.publish(
      "audio.uploaded",
      {
        ...audioUpload,
        url: signedUrl, // Include signed URL in event for immediate use
      },
      audioUpload.id
    );

    // Process uploaded audio with workflow or fallback to tasks
    await this.processUploadedAudio(episodeId, showId, audioId, url); // Pass R2 key instead of signed URL

    // Return upload info with signed URL for immediate use
    return {
      ...audioUpload,
      url: signedUrl,
    };
  }

  // Process uploaded audio with workflow-only approach
  private async processUploadedAudio(
    episodeId: string,
    showId: string,
    audioId: string,
    audioR2Key: string // Changed parameter name to be clearer
  ): Promise<void> {
    if (!this.audioProcessingWorkflow) {
      throw new Error(
        "Audio processing workflow not available - workflow processing required"
      );
    }

    console.log(
      `Starting audio processing workflow for uploaded audio: episodeId=${episodeId}`
    );

    try {
      // Start the audio processing workflow
      const workflowInstance = await this.audioProcessingWorkflow.create({
        params: {
          episodeId,
          audioR2Key, // Use R2 key instead of signed URL
          chunkDuration: 30,
          overlapDuration: 2,
          encodingFormats: ["mp3_128"], // Use MP3 format with auto-adjusted bitrate based on mono/stereo
          transcriptionLanguage: "en", // Default to English to prevent mixed language issues
        },
      });

      console.log(
        `Started audio processing workflow ${workflowInstance.id} for episode ${episodeId}`
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

      // Publish workflow started event
      await this.eventPublisher.publish(
        "episode.audio_processing_workflow_started",
        {
          episodeId,
          workflowId: workflowInstance.id,
          audioUrl: eventSignedUrl,
          audioR2Key, // Include R2 key for workflow consumers
          type: "workflow",
        },
        episodeId
      );
    } catch (error) {
      console.error(
        `Failed to start audio processing workflow for episode ${episodeId}:`,
        error
      );
      // Re-throw the error since we're workflow-only now
      throw new Error(
        `Workflow startup failed: ${
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
}
