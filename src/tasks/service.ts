import { TaskRepository } from "./repository.js";
import { EpisodeRepository } from "../episodes/repository.js";
import { EventPublisher } from "../events/publisher.js";
import type { Task } from "../database/schema.js";
import { v4 as uuidv4 } from "uuid";

export type TaskType = "transcribe" | "encode" | "publish" | "notification";

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

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    ai?: Ai,
    queue?: Queue
  ) {
    this.repository = new TaskRepository(database);
    this.episodeRepository = new EpisodeRepository(database);
    this.eventPublisher = new EventPublisher();
    this.bucket = bucket;
    this.ai = ai;
    this.queue = queue;
  }

  async createTask(type: TaskType, payload?: TaskPayload): Promise<Task> {
    const now = new Date().toISOString();
    return await this.repository.create({
      type,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      payload: payload ? JSON.stringify(payload) : undefined,
    } as any);
  }

  async getTask(id: number): Promise<Task | null> {
    return await this.repository.findById(id);
  }

  async getTasks(status?: string, limit = 10, offset = 0): Promise<Task[]> {
    return await this.repository.findByStatus(status, limit, offset);
  }

  async processPendingTasks(batchSize = 5): Promise<void> {
    const pendingTasks = await this.repository.findPendingTasks(batchSize);

    for (const task of pendingTasks) {
      await this.processTask(task);
    }
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

  // Test encoding method that performs encoding directly without creating a task
  async testEncode(payload: TaskPayload): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for encoding");
    }

    const startTime = Date.now();
    console.log("Starting test encoding:", payload);

    try {
      // Call the private handleEncode method directly
      const result = await this.handleEncode(payload);

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

  private async processTask(task: Task): Promise<void> {
    try {
      // Mark task as processing and increment attempts
      await this.repository.incrementAttempts(task.id);

      // Parse payload
      const payload = task.payload ? JSON.parse(task.payload) : {};

      // Process based on task type
      const result = await this.executeTask(task.type, payload);

      // Mark as done with result
      await this.repository.markAsDone(task.id, result);
    } catch (error) {
      // Mark as failed with error message
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.repository.markAsFailed(task.id, errorMessage);
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

  private async handleEncode(payload: TaskPayload): Promise<TaskResult> {
    if (!this.bucket) {
      throw new Error("R2 bucket binding is required for encoding");
    }

    const {
      episodeId,
      audioUrl,
      outputFormat = "mp3",
      bitrate = 128,
    } = payload;
    if (!episodeId || !audioUrl) {
      throw new Error("Episode ID and audio URL are required for encoding");
    }

    console.log("Processing encode task:", {
      episodeId,
      audioUrl,
      outputFormat,
      bitrate,
    });

    try {
      // Call the external encoding service
      const encodingServiceUrl =
        process.env.ENCODING_SERVICE_URL ||
        "https://encoding-service.sesamy-dev.workers.dev";

      console.log("Calling encoding service:", encodingServiceUrl);
      const response = await fetch(`${encodingServiceUrl}/encode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioUrl, outputFormat, bitrate }),
      });

      if (!response.ok) {
        throw new Error(`Encoding service failed: ${response.statusText}`);
      }

      const encodingResult = (await response.json()) as EncodingServiceResponse;

      if (!encodingResult.success) {
        throw new Error(`Encoding failed: ${encodingResult.error}`);
      }

      if (!encodingResult.encodedData) {
        throw new Error("No encoded data received from encoding service");
      }

      console.log("Encoding completed, uploading to R2...");

      // Upload encoded data to R2
      const encodedBuffer = Buffer.from(encodingResult.encodedData, "base64");
      const encodedId = uuidv4();
      const encodedKey = `episodes/${episodeId}/encoded/${encodedId}.${outputFormat}`;

      await this.bucket.put(encodedKey, encodedBuffer, {
        httpMetadata: {
          contentType: outputFormat === "mp3" ? "audio/mpeg" : "audio/aac",
        },
        customMetadata: {
          episodeId,
          format: outputFormat,
          bitrate: bitrate.toString(),
          encodedAt: new Date().toISOString(),
          originalSize: encodingResult.metadata?.size?.toString() || "0",
          duration: encodingResult.metadata?.duration?.toString() || "0",
        },
      });

      // Construct the encoded audio URL
      const encodedUrl = `${
        process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
      }/${encodedKey}`;

      // Update the episode with the encoded audio URL
      await this.episodeRepository.updateByIdOnly(episodeId, {
        audioUrl: encodedUrl, // Update main audio URL to encoded version
      });

      // Publish completion event
      await this.eventPublisher.publish(
        "episode.encoding_completed",
        {
          episodeId,
          encodedUrl,
          format: outputFormat,
          bitrate,
          size: encodedBuffer.length,
          duration: encodingResult.metadata?.duration || 0,
        },
        episodeId
      );

      console.log("Encoding completed:", {
        episodeId,
        encodedUrl,
        format: outputFormat,
        bitrate,
        size: encodedBuffer.length,
        duration: encodingResult.metadata?.duration || 0,
      });

      return {
        encodedUrl,
        encodedKey,
        format: outputFormat,
        bitrate,
        size: encodedBuffer.length,
        duration: encodingResult.metadata?.duration || 0,
        completedAt: new Date().toISOString(),
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
}
