import { v4 as uuidv4 } from "uuid";
import { AudioRepository } from "./repository";
import { EventPublisher } from "../events/publisher";
import { EpisodeRepository } from "../episodes/repository";
import { NotFoundError } from "../common/errors";
import { R2PreSignedUrlGenerator } from "../utils";
import {
  EncodingService,
  type EncodingServiceConfig,
} from "../encoding/service";
import type { MultipartUploadState } from "./multipart-upload-session";

export class AudioService {
  private audioRepo: AudioRepository;
  private eventPublisher: EventPublisher;
  private episodeRepo: EpisodeRepository;
  private audioProcessingWorkflow?: Workflow;
  private encodingWorkflow?: Workflow;
  private bucket: R2Bucket;
  private presignedUrlGenerator: R2PreSignedUrlGenerator | null = null;
  private database?: D1Database;
  private encodingService?: EncodingService;
  private multipartUploadSession?: DurableObjectNamespace;

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    eventPublisher?: EventPublisher,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string,
    audioProcessingWorkflow?: Workflow,
    encodingWorkflow?: Workflow,
    encodingContainer?: DurableObjectNamespace,
    multipartUploadSession?: DurableObjectNamespace
  ) {
    this.database = database;
    this.audioRepo = new AudioRepository(database);
    this.episodeRepo = new EpisodeRepository(database);
    this.eventPublisher = eventPublisher || new EventPublisher();
    this.audioProcessingWorkflow = audioProcessingWorkflow;
    this.encodingWorkflow = encodingWorkflow;
    this.bucket = bucket as R2Bucket;
    this.multipartUploadSession = multipartUploadSession;

    console.log(
      `AudioService initialized with workflows: audioProcessing=${!!audioProcessingWorkflow}, encoding=${!!encodingWorkflow}`
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

    // Initialize encoding service if container is available
    if (encodingContainer) {
      const encodingConfig: EncodingServiceConfig = {
        type: "cloudflare",
        cloudflare: {
          container: encodingContainer,
        },
      };
      this.encodingService = new EncodingService(encodingConfig);
      console.log("Encoding service initialized for chapter extraction");
    }
  }

  async uploadAudio(
    showId: string,
    episodeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: ArrayBuffer | Buffer;
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
      // Upload to R2 bucket with cache headers
      await this.bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.mimeType,
          cacheControl: "public, max-age=31536000, immutable",
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

    // Extract chapters from audio file (non-blocking, optional)
    this.extractAndUpdateChapters(showId, episodeId, url).catch((error) => {
      console.error("Chapter extraction failed (non-critical):", error);
    });

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
      const show = await showRepo.findById(
        episode.showId,
        episode.organizationId
      );

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
        `Creating TaskService with workflows: audioProcessing=${!!this
          .audioProcessingWorkflow}, encoding=${!!this.encodingWorkflow}`
      );
      const taskService = new TaskService(
        this.database,
        this.audioProcessingWorkflow,
        undefined, // importShowWorkflow
        undefined, // ttsGenerationWorkflow
        this.encodingWorkflow
      );

      // Create an audio_processing task with the required payload
      const task = await taskService.createTask(
        "audio_processing",
        {
          episodeId,
          audioR2Key, // Use R2 key instead of signed URL
          chunkDuration,
          encodingFormats: ["mp3_128"], // Use MP3 format with auto-adjusted bitrate based on mono/stereo
          transcriptionLanguage,
        },
        episode.organizationId
      );

      console.log(
        `Created audio processing task ${task.id} for episode ${episodeId}`
      );

      // Create an audio_encoding task for encoding the audio to podcast formats
      const encodingTask = await taskService.createTask(
        "audio_encoding",
        {
          episodeId,
          audioR2Key, // Use R2 key instead of signed URL
          encodingFormats: ["mp3_128"], // Use MP3 format with auto-adjusted bitrate based on mono/stereo
          organizationId: episode.organizationId, // Include organizationId in payload
        },
        episode.organizationId
      );

      console.log(
        `Created audio encoding task ${encodingTask.id} for episode ${episodeId}`
      );

      // Generate signed URL for event payload (events may need accessible URLs)
      let eventSignedUrl = audioR2Key;
      if (this.presignedUrlGenerator && audioR2Key.startsWith("r2://")) {
        try {
          const r2Key = audioR2Key.replace("r2://", "");
          eventSignedUrl =
            await this.presignedUrlGenerator.generatePresignedUrl(
              "podcast-service-assets",
              r2Key,
              3600, // 1 hour
              "GET"
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

  async generatePresignedUrlWithCors(r2Key: string): Promise<string | null> {
    if (!this.presignedUrlGenerator) {
      return null;
    }

    try {
      // Force AWS signature even with custom domain for CORS-sensitive downloads
      return await this.presignedUrlGenerator.generatePresignedUrl(
        "podcast-service-assets",
        r2Key,
        28800, // 8 hours
        "GET",
        undefined,
        true // forceSignature for CORS support
      );
    } catch (error) {
      console.warn(
        "Failed to generate CORS presigned URL for key:",
        r2Key,
        error
      );
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
    const show = await showRepo.findById(
      episode.showId,
      episode.organizationId
    );

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
    const task = await taskService.createTask(
      "audio_processing",
      payload,
      episode.organizationId
    );

    console.log(
      `Created audio processing task ${task.id} for episode ${episodeId} using ${transcriptionModel} (${payload.chunkDuration}s chunks) with language ${transcriptionLanguage}`
    );

    return task;
  }

  // Multipart upload support using R2's native multipart API with Durable Object state
  private getUploadSession(uploadId: string) {
    if (!this.multipartUploadSession) {
      throw new Error("Multipart upload session not configured");
    }
    const id = this.multipartUploadSession.idFromName(uploadId);
    return this.multipartUploadSession.get(id);
  }

  async initiateMultipartUpload(
    showId: string,
    episodeId: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
    totalChunks: number
  ) {
    const uploadId = uuidv4();
    const audioId = uuidv4();
    const r2Key = `audio/${showId}/${episodeId}/${audioId}/${fileName}`;

    // Initiate R2 multipart upload with cache headers
    const r2Upload = await this.bucket.createMultipartUpload(r2Key, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    // Store session state in Durable Object
    const session = this.getUploadSession(uploadId);
    const response = await session.fetch("https://stub/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        episodeId,
        showId,
        audioId,
        fileName,
        fileSize,
        mimeType,
        r2Key,
        r2UploadId: r2Upload.uploadId,
        totalChunks,
        uploadedParts: [],
        createdAt: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to initialize upload session: ${await response.text()}`
      );
    }

    return {
      uploadId,
      fileName,
      totalChunks,
    };
  }

  async uploadChunk(
    uploadId: string,
    chunkNumber: number,
    chunkData: ArrayBuffer
  ) {
    // Get upload state from Durable Object
    const session = this.getUploadSession(uploadId);
    const stateResponse = await session.fetch("https://stub/getState");
    if (!stateResponse.ok) {
      throw new NotFoundError("Upload session not found or expired");
    }
    const upload = (await stateResponse.json()) as MultipartUploadState;
    if (!upload) {
      throw new NotFoundError("Upload session not found or expired");
    }

    // Upload the chunk to R2 as a part
    const r2Upload = this.bucket.resumeMultipartUpload(
      upload.r2Key,
      upload.r2UploadId
    );
    const uploadedPart = await r2Upload.uploadPart(chunkNumber, chunkData);

    // Store the part information in Durable Object (handles retries automatically)
    const addPartResponse = await session.fetch("https://stub/addPart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partNumber: chunkNumber,
        etag: uploadedPart.etag,
      }),
    });

    if (!addPartResponse.ok) {
      throw new Error(`Failed to store part: ${await addPartResponse.text()}`);
    }

    const { received, total } = (await addPartResponse.json()) as {
      received: number;
      total: number;
    };

    return {
      uploadId,
      chunkNumber,
      received,
      total,
    };
  }

  async completeMultipartUpload(showId: string, uploadId: string) {
    // Get upload state from Durable Object
    const session = this.getUploadSession(uploadId);
    const stateResponse = await session.fetch("https://stub/getState");
    if (!stateResponse.ok) {
      throw new NotFoundError("Upload session not found or expired");
    }
    const upload = (await stateResponse.json()) as MultipartUploadState;
    if (!upload) {
      throw new NotFoundError("Upload session not found or expired");
    }

    // Check if all chunks are received
    if (upload.uploadedParts.length !== upload.totalChunks) {
      throw new Error(
        `Missing chunks: received ${upload.uploadedParts.length} of ${upload.totalChunks}`
      );
    }

    // Sort parts by part number
    const sortedParts = upload.uploadedParts.sort(
      (a, b) => a.partNumber - b.partNumber
    );

    // Verify all parts are sequential
    for (let i = 0; i < sortedParts.length; i++) {
      if (sortedParts[i].partNumber !== i + 1) {
        throw new Error(`Missing part ${i + 1}`);
      }
    }

    // Complete the R2 multipart upload
    const r2Upload = this.bucket.resumeMultipartUpload(
      upload.r2Key,
      upload.r2UploadId
    );
    await r2Upload.complete(
      sortedParts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
    );

    // Verify episode exists
    const episode = await this.episodeRepo.findById(
      upload.showId,
      upload.episodeId
    );
    if (!episode) {
      throw new NotFoundError("Episode not found");
    }

    // Use the audioId stored in the upload session
    const audioId = upload.audioId;

    // Store the R2 key with a special prefix for database storage
    const url = `r2://${upload.r2Key}`;

    // Generate URL for immediate use and episode update
    let signedUrl: string;
    if (this.presignedUrlGenerator) {
      try {
        // Use direct URL with custom domain if available
        const directUrl = this.presignedUrlGenerator.generateDirectUrl(
          "podcast-service-assets",
          upload.r2Key
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

    // Save audio metadata
    const audioUpload = await this.audioRepo.create({
      id: audioId,
      episodeId: upload.episodeId,
      fileName: upload.fileName,
      fileSize: upload.fileSize,
      mimeType: upload.mimeType,
      url: url,
    });

    // Update episode with audio URL
    await this.episodeRepo.updateByIdOnly(upload.episodeId, {
      audioUrl: url,
    });

    // Publish event
    await this.eventPublisher.publish(
      "audio.uploaded",
      {
        ...audioUpload,
        url: signedUrl,
      },
      audioUpload.id
    );

    // Extract chapters from audio file (non-blocking, optional)
    this.extractAndUpdateChapters(upload.showId, upload.episodeId, url).catch(
      (error) => {
        console.error("Chapter extraction failed (non-critical):", error);
      }
    );

    // Clean up the multipart upload session from Durable Object
    await session.fetch("https://stub/delete", { method: "POST" });

    return {
      ...audioUpload,
      url: signedUrl,
    };
  }

  async abortMultipartUpload(uploadId: string) {
    // Get upload state from Durable Object
    const session = this.getUploadSession(uploadId);
    const stateResponse = await session.fetch("https://stub/getState");
    if (!stateResponse.ok) {
      throw new NotFoundError("Upload session not found or expired");
    }
    const upload = (await stateResponse.json()) as MultipartUploadState;
    if (!upload) {
      throw new NotFoundError("Upload session not found or expired");
    }

    // Abort the R2 upload
    const r2Upload = this.bucket.resumeMultipartUpload(
      upload.r2Key,
      upload.r2UploadId
    );
    await r2Upload.abort();

    // Clean up the session from Durable Object
    await session.fetch("https://stub/delete", { method: "POST" });

    return { success: true };
  }

  async getMultipartUploadStatus(uploadId: string) {
    // Get upload state from Durable Object
    const session = this.getUploadSession(uploadId);
    const stateResponse = await session.fetch("https://stub/getState");
    if (!stateResponse.ok) {
      return null;
    }
    const upload = (await stateResponse.json()) as MultipartUploadState | null;
    if (!upload) {
      return null;
    }

    return {
      uploadId: upload.uploadId,
      fileName: upload.fileName,
      fileSize: upload.fileSize,
      totalChunks: upload.totalChunks,
      receivedChunks: upload.uploadedParts.length,
      complete: upload.uploadedParts.length === upload.totalChunks,
    };
  }

  /**
   * Extract chapters from audio file and update episode
   */
  async extractAndUpdateChapters(
    showId: string,
    episodeId: string,
    audioR2Key: string
  ) {
    if (!this.encodingService) {
      console.warn(
        "Encoding service not available, skipping chapter extraction"
      );
      return;
    }

    try {
      console.log(`Extracting chapters from audio for episode ${episodeId}`);

      // Strip r2:// prefix if present
      const actualR2Key = audioR2Key.startsWith("r2://")
        ? audioR2Key.substring(5)
        : audioR2Key;

      // Generate signed URL for the audio file
      let audioUrl: string;
      if (this.presignedUrlGenerator) {
        audioUrl = await this.presignedUrlGenerator.generatePresignedUrl(
          "podcast-service-assets",
          actualR2Key,
          3600 // 1 hour
        );
      } else {
        throw new Error("Cannot generate URL for chapter extraction");
      }

      // Get metadata including chapters
      const metadata = await this.encodingService.getMetadata({ audioUrl });

      if (!metadata.success) {
        console.warn(`Failed to extract metadata: ${metadata.error}`);
        return;
      }

      // If chapters were found, update the episode
      if (metadata.chapters && metadata.chapters.length > 0) {
        console.log(
          `Found ${metadata.chapters.length} chapters, updating episode`
        );
        await this.episodeRepo.update(showId, episodeId, {
          chapters: metadata.chapters,
        });
        console.log(
          `Updated episode ${episodeId} with ${metadata.chapters.length} chapters`
        );
      } else {
        console.log(`No chapters found in audio file`);
      }
    } catch (error) {
      console.error(`Failed to extract chapters: ${error}`);
      // Don't throw - chapter extraction is optional
    }
  }
}
