import { TaskRepository } from "./repository.js";
import { EpisodeRepository } from "../episodes/repository.js";
import { EventPublisher } from "../events/publisher.js";
import { R2PreSignedUrlGenerator } from "../audio/service.js";
import type { Task } from "../database/schema.js";
import { v4 as uuidv4 } from "uuid";

export type TaskType =
  | "transcribe"
  | "encode"
  | "audio_preprocess"
  | "publish"
  | "notification";

export interface TaskPayload {
  [key: string]: any;
}

export interface TaskResult {
  [key: string]: any;
}

// Encoding service response interface
interface EncodingServiceResponse {
  success: boolean;
  encodedData?: string;
  error?: string;
  metadata?: {
    format: string;
    bitrate: number;
    duration?: number;
    size: number;
  };
}

export class TaskService {
  private repository: TaskRepository;
  private episodeRepository: EpisodeRepository;
  private eventPublisher: EventPublisher;
  private bucket?: R2Bucket;
  private ai?: Ai;
  private queue?: Queue;
  private encodingContainer?: DurableObjectNamespace;
  private presignedUrlGenerator: R2PreSignedUrlGenerator | null = null;

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    ai?: Ai,
    queue?: Queue,
    encodingContainer?: DurableObjectNamespace,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string
  ) {
    this.repository = new TaskRepository(database);
    this.episodeRepository = new EpisodeRepository(database);
    this.eventPublisher = new EventPublisher();
    this.bucket = bucket;
    this.ai = ai;
    this.queue = queue;
    this.encodingContainer = encodingContainer;

    // Initialize presigned URL generator if credentials are available
    if (r2AccessKeyId && r2SecretAccessKey) {
      console.log("Initializing R2PreSignedUrlGenerator for TaskService");
      this.presignedUrlGenerator = new R2PreSignedUrlGenerator(
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
    } else {
      console.warn(
        "R2 credentials not available, signed URLs will not be generated"
      );
    }
  }

  async createTask(type: TaskType, payload?: TaskPayload): Promise<Task> {
    const now = new Date().toISOString();
    const task = await this.repository.create({
      type,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      payload: payload ? JSON.stringify(payload) : undefined,
    } as any);

    // Immediately send task to queue for processing if queue is available
    if (this.queue) {
      await this.queue.send({
        type: "task",
        taskId: task.id,
        payload: payload,
      });
      console.log(`Task ${task.id} sent to queue for immediate processing`);
    } else {
      console.warn("Queue not available, task will be processed in next batch");
    }

    return task;
  }

  async getTask(id: number): Promise<Task | null> {
    return await this.repository.findById(id);
  }

  async getTasks(
    status?: string,
    limit = 10,
    offset = 0,
    sortBy = "created_at",
    sortOrder = "desc"
  ): Promise<Task[]> {
    return await this.repository.findByStatus(
      status,
      limit,
      offset,
      sortBy,
      sortOrder
    );
  }

  async processPendingTasks(batchSize = 5): Promise<void> {
    console.log(`Looking for pending tasks (batch size: ${batchSize})`);
    const pendingTasks = await this.repository.findPendingTasks(batchSize);
    console.log(`Found ${pendingTasks.length} pending tasks`);

    for (const task of pendingTasks) {
      console.log(
        `Processing task ${task.id} (type: ${task.type}, status: ${task.status})`
      );
      await this.processTask(task);
    }

    console.log(`Completed processing ${pendingTasks.length} tasks`);
  }

  async retryTask(id: number): Promise<Task> {
    const task = await this.repository.findById(id);
    if (!task) {
      throw new Error("Task not found");
    }

    // Reset the task status to pending and clear errors
    const retriedTask = await this.repository.resetForRetry(id);
    if (!retriedTask) {
      throw new Error("Failed to reset task for retry");
    }

    // Create a new queue message if queue is available
    if (this.queue) {
      await this.queue.send({
        type: "task",
        taskId: id,
      });
    } else {
      console.warn(
        "Queue not available, task will only be reset to pending status"
      );
    }

    return retriedTask;
  }

  // Method for task handlers to update progress
  async updateTaskProgress(taskId: number, progress: number): Promise<void> {
    console.log(`Updating task ${taskId} progress to ${progress}%`);
    await this.repository.updateProgress(taskId, progress);
  }

  // Test encoding method that performs encoding directly without creating a task
  async testEncode(payload: TaskPayload): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for encoding");
    }

    const startTime = Date.now();
    console.log("Starting test encoding:", payload);

    try {
      // Use default test audio URL if none provided
      const audioUrl =
        payload.audioUrl ||
        "https://www.soundjay.com/misc/sounds/fail-buzzer-02.mp3";
      const testPayload = {
        ...payload,
        audioUrl,
        episodeId: payload.episodeId || `test-encode-${Date.now()}`,
      };

      // Call the private handleEncode method directly (this uses the container)
      const result = await this.handleEncode(testPayload);

      // Add processing time to the result
      const processingTime = Date.now() - startTime;
      return {
        ...result,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`,
        testMode: true,
      };
    } catch (error) {
      console.error("Test encoding failed:", error);
      throw error;
    }
  }

  async processTask(task: Task): Promise<void> {
    console.log(`Starting to process task ${task.id} (type: ${task.type})`);

    try {
      // Mark task as started with timestamp and set progress to 0
      console.log(`Marking task ${task.id} as started...`);
      const updatedTask = await this.repository.markAsStarted(task.id);
      console.log(
        `Task ${task.id} started at: ${updatedTask?.startedAt}, status: ${updatedTask?.status}`
      );

      // Parse payload and pass task ID for progress updates
      const payload = task.payload ? JSON.parse(task.payload) : {};
      payload.taskId = task.id; // Add task ID to payload for progress updates

      // Process based on task type
      console.log(`Executing task ${task.id} with type: ${task.type}`);
      const result = await this.executeTask(task.type, payload);

      // Mark as done with result and set progress to 100
      console.log(`Task ${task.id} completed successfully, marking as done`);
      await this.repository.markAsDone(task.id, result);
      await this.repository.updateProgress(task.id, 100);
      console.log(`Task ${task.id} marked as done with 100% progress`);
    } catch (error) {
      // Mark as failed with error message
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.log(`Task ${task.id} failed with error: ${errorMessage}`);
      await this.repository.markAsFailed(task.id, errorMessage);
      console.log(`Task ${task.id} marked as failed`);
    }
  }

  private async executeTask(
    type: string,
    payload: TaskPayload
  ): Promise<TaskResult> {
    // Task handlers - these are stubs that can be implemented later
    switch (type) {
      case "transcribe":
        return await this.handleTranscribe(payload);

      case "encode":
        return await this.handleEncode(payload);

      case "audio_preprocess":
        return await this.handleAudioPreprocess(payload);

      case "publish":
        return await this.handlePublish(payload);

      case "notification":
        return await this.handleNotification(payload);

      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }

  // Task handler stubs - implement these with actual logic
  private async handleTranscribe(payload: TaskPayload): Promise<TaskResult> {
    if (!this.ai || !this.bucket) {
      throw new Error(
        "AI and R2 bucket bindings are required for transcription"
      );
    }

    const { episodeId, audioUrl } = payload;
    if (!episodeId || !audioUrl) {
      throw new Error(
        "Episode ID and audio URL are required for transcription"
      );
    }

    console.log("Processing transcribe task:", { episodeId, audioUrl });

    try {
      // Fetch the audio file
      console.log("Fetching audio file from:", audioUrl);
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Failed to fetch audio file: ${audioResponse.status} ${audioResponse.statusText}`
        );
      }

      const contentLength = audioResponse.headers.get("content-length");
      console.log("Audio file size:", contentLength, "bytes");

      const audioArrayBuffer = await audioResponse.arrayBuffer();
      const audioSize = audioArrayBuffer.byteLength;
      console.log("Downloaded audio buffer size:", audioSize, "bytes");

      // Check if audio file is too large (Whisper has a limit of ~25MB)
      const maxSize = 25 * 1024 * 1024; // 25MB
      if (audioSize > maxSize) {
        throw new Error(
          `Audio file too large: ${audioSize} bytes (max: ${maxSize} bytes)`
        );
      }

      // Log audio file info
      const contentType = audioResponse.headers.get("content-type");
      console.log("Audio content type:", contentType);

      // Use Cloudflare Workers AI Whisper model for transcription with retry
      console.log("Starting AI transcription...");
      const transcriptResponse = await this.runAIWithRetry(audioArrayBuffer);

      console.log("AI transcription completed");

      if (!transcriptResponse || !transcriptResponse.text) {
        throw new Error("Transcription failed - no text returned");
      }

      const transcriptText = transcriptResponse.text;

      // Generate a unique filename for the transcript
      const transcriptId = uuidv4();
      const transcriptKey = `transcripts/${episodeId}/${transcriptId}.txt`;

      // Store transcript in R2
      await this.bucket.put(transcriptKey, transcriptText, {
        httpMetadata: {
          contentType: "text/plain",
          contentLanguage: "en",
        },
        customMetadata: {
          episodeId,
          createdAt: new Date().toISOString(),
        },
      });

      // Construct the transcript URL
      const transcriptUrl = `${
        process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
      }/${transcriptKey}`;

      // Update the episode with the transcript URL
      await this.episodeRepository.updateByIdOnly(episodeId, {
        transcriptUrl,
      });

      // Publish completion event
      await this.eventPublisher.publish(
        "episode.transcription_completed",
        { episodeId, transcriptUrl, textLength: transcriptText.length },
        episodeId
      );

      console.log("Transcription completed:", {
        episodeId,
        transcriptUrl,
        textLength: transcriptText.length,
      });

      return {
        transcriptUrl,
        transcriptKey,
        textLength: transcriptText.length,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Transcription failed:", error);
      throw error;
    }
  }

  private async handleAudioPreprocess(
    payload: TaskPayload
  ): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for audio preprocessing");
    }

    const { episodeId, audioUrl, showId } = payload;
    if (!episodeId || !audioUrl) {
      throw new Error(
        "Episode ID and audio URL are required for audio preprocessing"
      );
    }

    console.log("Processing audio preprocessing task:", {
      episodeId,
      audioUrl,
    });

    try {
      // Fetch the original audio file
      console.log("Fetching original audio file from:", audioUrl);
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Failed to fetch audio file: ${audioResponse.status} ${audioResponse.statusText}`
        );
      }

      const audioArrayBuffer = await audioResponse.arrayBuffer();
      const audioSize = audioArrayBuffer.byteLength;
      console.log("Original audio file size:", audioSize, "bytes");

      // TODO: For now, simulate the preprocessing step
      // In a real implementation, this would use FFmpeg to convert to 32kbps mono
      console.log(
        "Simulating audio preprocessing (FFmpeg conversion to 32kbps mono)..."
      );

      // Create a smaller mock processed audio file
      const processedAudioData = Buffer.alloc(Math.floor(audioSize * 0.1)); // Simulate 10% of original size

      // Generate a unique filename for the preprocessed audio
      const preprocessedId = uuidv4();
      const preprocessedKey = `preprocessed-audio/${episodeId}/${preprocessedId}.mp3`;

      // Store preprocessed audio in R2
      await this.bucket.put(preprocessedKey, processedAudioData, {
        httpMetadata: {
          contentType: "audio/mpeg",
        },
        customMetadata: {
          episodeId,
          originalSize: audioSize.toString(),
          processedSize: processedAudioData.length.toString(),
          format: "mp3",
          bitrate: "32",
          channels: "1",
          processedAt: new Date().toISOString(),
        },
      });

      // Generate signed URL for the preprocessed audio
      let preprocessedUrl: string;
      const bucketName = "podcast-service-assets"; // Default bucket name

      if (this.presignedUrlGenerator) {
        try {
          console.log(
            "Generating signed URL for preprocessed audio:",
            preprocessedKey
          );
          preprocessedUrl =
            await this.presignedUrlGenerator.generatePresignedUrl(
              bucketName,
              preprocessedKey,
              28800 // 8 hours expiry
            );
          console.log("Generated signed URL:", preprocessedUrl);
        } catch (error) {
          console.warn("Failed to generate signed URL, using fallback:", error);
          preprocessedUrl = `${
            process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
          }/${preprocessedKey}`;
        }
      } else {
        console.warn("No presigned URL generator available, using public URL");
        preprocessedUrl = `${
          process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
        }/${preprocessedKey}`;
      }

      console.log("Audio preprocessing completed:", {
        episodeId,
        originalSize: audioSize,
        processedSize: processedAudioData.length,
        preprocessedUrl: preprocessedUrl.substring(0, 100) + "...", // Truncate long signed URL for logging
      });

      // Create the transcription task with the preprocessed audio
      console.log("Creating transcription task with preprocessed audio...");
      await this.createTask("transcribe", {
        episodeId,
        showId,
        audioUrl: preprocessedUrl, // Use preprocessed audio for transcription
        preprocessed: true,
      });

      // Calculate duration estimate (mock calculation for now)
      const estimatedDuration = Math.floor(audioSize / (32000 / 8)); // rough estimate based on 32kbps bitrate

      return {
        encodedUrl: preprocessedUrl, // Use same field name as encode for consistency
        encodedKey: preprocessedKey, // Use same field name as encode for consistency
        format: "mp3",
        bitrate: 32,
        size: processedAudioData.length,
        duration: estimatedDuration,
        completedAt: new Date().toISOString(),
        isSignedUrl: !!this.presignedUrlGenerator,
        urlExpiresIn: this.presignedUrlGenerator ? "8 hours" : null,
        containerUsed: false, // preprocessing doesn't use the encoding container
        metadata: {
          originalSize: audioSize,
          processedSize: processedAudioData.length,
          channels: 1,
          compressionRatio:
            (
              ((audioSize - processedAudioData.length) / audioSize) *
              100
            ).toFixed(1) + "%",
        },
        nextTaskCreated: "transcribe",
      };
    } catch (error) {
      console.error("Audio preprocessing failed:", error);
      throw error;
    }
  }

  private async handleEncode(payload: TaskPayload): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for encoding");
    }

    const {
      episodeId,
      audioUrl,
      outputFormat = "mp3",
      bitrate = 128,
      taskId,
    } = payload;

    if (!audioUrl) {
      throw new Error("Audio URL is required for encoding");
    }

    // For test scenarios, we can proceed without an episodeId
    if (!episodeId) {
      console.log("Running encoding in test mode without episodeId");
    }

    console.log("Processing encode task:", {
      episodeId,
      audioUrl,
      outputFormat,
      bitrate,
      taskId,
    });

    try {
      // Update progress: Starting encoding
      if (taskId) {
        await this.updateTaskProgress(taskId, 10);
      }

      // Use the encoding container for actual FFmpeg encoding
      console.log("Using encoding container for FFmpeg processing...");

      // Get the EncodingContainer instance
      if (!this.encodingContainer) {
        throw new Error("Encoding container not available");
      }

      // Create a unique session ID for this encoding task
      const sessionId = `encode-${Date.now()}`;
      const containerId = this.encodingContainer.idFromName(sessionId);
      const container = this.encodingContainer.get(containerId);

      // Update progress: Container initialized
      if (taskId) {
        await this.updateTaskProgress(taskId, 25);
      }

      // Prepare the request for the container with streaming enabled
      const containerRequest = new Request("http://localhost/encode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioUrl,
          outputFormat,
          bitrate,
          episodeId: episodeId || `test-encode-${Date.now()}`,
          streaming: true, // Enable streaming progress
        }),
      });

      // Send the request to the encoding container
      console.log("Sending streaming encoding request to container...");
      const containerResponse = await container.fetch(containerRequest);

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        throw new Error(`Container encoding failed: ${errorText}`);
      }

      // Handle streaming response
      const reader = containerResponse.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines (SSE format: "data: {json}\n\n")
          let lines = buffer.split("\n\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.substring(6)); // Remove "data: " prefix

                if (data.type === "progress" && taskId) {
                  // Update task progress
                  await this.updateTaskProgress(taskId, data.progress);
                  console.log(
                    `Container progress: ${data.progress}% - ${data.message}`
                  );
                } else if (data.type === "complete") {
                  // Store the final result
                  finalResult = data;
                  console.log("Container encoding completed");
                } else if (data.type === "error") {
                  throw new Error(data.error || "Container encoding failed");
                }
              } catch (parseError) {
                console.warn(
                  "Failed to parse progress data:",
                  line,
                  parseError
                );
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!finalResult || !finalResult.success) {
        throw new Error("Container encoding did not complete successfully");
      }

      console.log("Container encoding result:", finalResult);

      // Extract encoded data from container response
      const encodedData = finalResult.encodedData;
      if (!encodedData) {
        throw new Error("No encoded data received from container");
      }

      // Generate a unique key for storing the encoded file
      const encodedId = uuidv4();
      const encodedKey = episodeId
        ? `episodes/${episodeId}/encoded/${encodedId}.${outputFormat}`
        : `test-encoding/${encodedId}.${outputFormat}`;

      // Convert base64 encoded data to Buffer
      const encodedBuffer = Buffer.from(encodedData, "base64");

      // Store the encoded file in R2
      await this.bucket.put(encodedKey, encodedBuffer, {
        httpMetadata: {
          contentType: outputFormat === "mp3" ? "audio/mpeg" : "audio/aac",
        },
        customMetadata: {
          episodeId: episodeId || "test",
          format: outputFormat,
          bitrate: bitrate.toString(),
          encodedAt: new Date().toISOString(),
          originalSize:
            finalResult.metadata?.originalSize?.toString() || "unknown",
          duration: finalResult.metadata?.duration?.toString() || "unknown",
          size: encodedBuffer.length.toString(),
        },
      });

      // Generate signed URL for the encoded audio
      let encodedUrl: string;
      const bucketName = "podcast-service-assets"; // Default bucket name

      if (this.presignedUrlGenerator) {
        try {
          console.log("Generating signed URL for encoded audio:", encodedKey);
          encodedUrl = await this.presignedUrlGenerator.generatePresignedUrl(
            bucketName,
            encodedKey,
            28800 // 8 hours expiry
          );
          console.log("Generated signed URL:", encodedUrl);
        } catch (error) {
          console.warn("Failed to generate signed URL, using fallback:", error);
          encodedUrl = `${
            process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
          }/${encodedKey}`;
        }
      } else {
        console.warn("No presigned URL generator available, using public URL");
        encodedUrl = `${
          process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
        }/${encodedKey}`;
      }

      // Update the episode with the R2 key (not signed URL) for storage
      // Store the key so we can regenerate signed URLs later
      if (episodeId && !episodeId.startsWith("test-encode-")) {
        await this.episodeRepository.updateByIdOnly(episodeId, {
          audioUrl: `r2://encoded/${encodedKey}`, // Store R2 key for regenerating signed URLs
        });
      }

      // Publish completion event (only if episodeId exists)
      if (episodeId) {
        await this.eventPublisher.publish(
          "episode.encoding_completed",
          {
            episodeId,
            encodedUrl,
            format: outputFormat,
            bitrate,
            size: encodedBuffer.length,
            duration: finalResult.metadata?.duration || 0,
          },
          episodeId
        );
      }

      console.log("Container encoding completed:", {
        episodeId: episodeId || "test",
        encodedUrl: encodedUrl.substring(0, 100) + "...", // Truncate long signed URL for logging
        encodedKey,
        format: outputFormat,
        bitrate,
        size: encodedBuffer.length,
        duration: finalResult.metadata?.duration || 0,
        signedUrl: !!this.presignedUrlGenerator,
      });

      // Final progress update before completion
      if (taskId) {
        await this.updateTaskProgress(taskId, 95);
      }

      return {
        encodedUrl,
        encodedKey,
        format: outputFormat,
        bitrate,
        size: encodedBuffer.length,
        duration: finalResult.metadata?.duration || 0,
        completedAt: new Date().toISOString(),
        isSignedUrl: !!this.presignedUrlGenerator,
        urlExpiresIn: this.presignedUrlGenerator ? "8 hours" : null,
        containerUsed: true,
        metadata: finalResult.metadata,
      };
    } catch (error) {
      console.error("Encoding failed:", error);
      throw error;
    }
  }

  private async handlePublish(payload: TaskPayload): Promise<TaskResult> {
    // Stub for episode publishing
    // In a real implementation, this would publish to podcast platforms
    console.log("Processing publish task:", payload);

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return {
      published_to: ["apple", "spotify", "google"],
      rss_updated: true,
      published_at: new Date().toISOString(),
    };
  }

  // Test method for direct transcription calls (used by test endpoints)
  async testTranscribe(payload: TaskPayload): Promise<TaskResult> {
    if (!this.ai || !this.bucket) {
      throw new Error(
        "AI and R2 bucket bindings are required for transcription"
      );
    }

    const { episodeId, audioUrl } = payload;
    if (!episodeId || !audioUrl) {
      throw new Error(
        "Episode ID and audio URL are required for transcription"
      );
    }

    console.log("Processing test transcribe:", { episodeId, audioUrl });

    try {
      // Fetch the audio file
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Failed to fetch audio file: ${audioResponse.statusText}`
        );
      }

      const audioArrayBuffer = await audioResponse.arrayBuffer();

      // Use Cloudflare Workers AI Whisper model for transcription
      const transcriptResponse = await this.ai.run("@cf/openai/whisper", {
        audio: Array.from(new Uint8Array(audioArrayBuffer)),
      });

      if (!transcriptResponse || !transcriptResponse.text) {
        throw new Error("Transcription failed - no text returned");
      }

      const transcriptText = transcriptResponse.text;

      // Generate a unique filename for the transcript
      const transcriptId = uuidv4();
      const transcriptKey = `transcripts/test/${episodeId}/${transcriptId}.txt`;

      // Store transcript in R2
      await this.bucket.put(transcriptKey, transcriptText, {
        httpMetadata: {
          contentType: "text/plain",
          contentLanguage: "en",
        },
        customMetadata: {
          episodeId,
          createdAt: new Date().toISOString(),
          testTranscription: "true",
        },
      });

      // Construct the transcript URL
      const transcriptUrl = `${
        process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
      }/${transcriptKey}`;

      // For test episodes, skip database updates
      if (!episodeId.startsWith("test-transcribe-")) {
        // Update the episode with the transcript URL
        await this.episodeRepository.updateByIdOnly(episodeId, {
          transcriptUrl,
        });

        // Publish completion event
        await this.eventPublisher.publish(
          "episode.transcription_completed",
          { episodeId, transcriptUrl, textLength: transcriptText.length },
          episodeId
        );
      }

      console.log("Test transcription completed:", {
        episodeId,
        transcriptUrl,
        textLength: transcriptText.length,
      });

      return {
        transcriptUrl,
        transcriptKey,
        textLength: transcriptText.length,
        transcriptText,
        completedAt: new Date().toISOString(),
        testMode: true,
      };
    } catch (error) {
      console.error("Test transcription failed:", error);
      throw error;
    }
  }

  // Test audio preprocessing method that performs preprocessing directly without creating a task
  async testAudioPreprocess(payload: TaskPayload): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for audio preprocessing");
    }

    const startTime = Date.now();
    console.log("Starting test audio preprocessing:", payload);

    try {
      // Use default test audio URL if none provided
      const audioUrl =
        payload.audioUrl ||
        "https://www.soundjay.com/misc/sounds/fail-buzzer-02.mp3";
      const testPayload = {
        ...payload,
        audioUrl,
        episodeId: payload.episodeId || `test-preprocess-${Date.now()}`,
      };

      // Call the private handleAudioPreprocess method directly
      const result = await this.handleAudioPreprocess(testPayload);

      // Add processing time to the result
      const processingTime = Date.now() - startTime;
      return {
        ...result,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`,
        testMode: true,
      };
    } catch (error) {
      console.error("Test audio preprocessing failed:", error);
      throw error;
    }
  }

  private async handleNotification(payload: TaskPayload): Promise<TaskResult> {
    // Stub for notifications
    // In a real implementation, this would send emails/webhooks
    console.log("Processing notification task:", payload);

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      sent_to: payload.recipients || [],
      delivery_status: "success",
      sent_at: new Date().toISOString(),
    };
  }

  // Helper method to run AI with retry logic
  private async runAIWithRetry(
    audioArrayBuffer: ArrayBuffer,
    maxRetries: number = 3
  ): Promise<any> {
    if (!this.ai) {
      throw new Error("AI binding not available");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`AI transcription attempt ${attempt}/${maxRetries}`);

        const result = await this.ai.run("@cf/openai/whisper", {
          audio: Array.from(new Uint8Array(audioArrayBuffer)),
        });

        console.log(`AI transcription attempt ${attempt} succeeded`);
        return result;
      } catch (error) {
        console.error(`AI transcription attempt ${attempt} failed:`, error);

        if (attempt === maxRetries) {
          // Last attempt failed, throw the error
          throw error;
        }

        // Wait before retrying (exponential backoff)
        const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
}
