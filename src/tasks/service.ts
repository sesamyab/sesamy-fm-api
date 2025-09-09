import { TaskRepository } from "./repository.js";
import { EpisodeRepository } from "../episodes/repository.js";
import { EventPublisher } from "../events/publisher.js";
import { R2PreSignedUrlGenerator } from "../utils";
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

// Maximum number of retry attempts for a task
const MAX_RETRIES = 3;

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
    console.log(
      `Looking for pending and retry tasks (batch size: ${batchSize})`
    );
    const pendingTasks = await this.repository.findPendingAndRetryTasks(
      batchSize
    );
    console.log(`Found ${pendingTasks.length} pending/retry tasks`);

    for (const task of pendingTasks) {
      console.log(
        `Processing task ${task.id} (type: ${task.type}, status: ${
          task.status
        }, attempts: ${task.attempts || 0})`
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

  /**
   * Enqueue a task for retry after a failure
   */
  private async enqueueRetry(taskId: number): Promise<void> {
    if (this.queue) {
      // In Cloudflare Workers, we'll immediately enqueue for retry
      // The retry delay will be handled by the task processing logic
      await this.queue.send({
        type: "task",
        taskId: taskId,
      });
      console.log(`Task ${taskId} enqueued for retry processing`);
    } else {
      console.warn(
        "Queue not available, retry task will need to be processed in next batch"
      );
    }
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

    // Calculate current attempts - this will be the attempt we're about to make
    const currentAttempts = (task.attempts || 0) + 1;
    console.log(
      `Processing task ${task.id} (attempt ${currentAttempts}/${MAX_RETRIES})`
    );

    try {
      // Mark task as started (processing) and update attempts in one call
      console.log(`Marking task ${task.id} as processing...`);
      const updatedTask = await this.repository.updateStatus(
        task.id,
        "processing",
        {
          attempts: currentAttempts,
          startedAt: new Date().toISOString(),
          progress: 0,
        }
      );

      console.log(
        `Task ${task.id} marked as processing - attempts: ${currentAttempts}, started at: ${updatedTask?.startedAt}`
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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.log(`Task ${task.id} failed with error: ${errorMessage}`);

      // Determine if we should retry based on current attempts
      if (currentAttempts < MAX_RETRIES) {
        // Set status to retry
        console.log(
          `Task ${task.id} will be retried (attempt ${currentAttempts}/${MAX_RETRIES})`
        );
        await this.repository.markAsRetry(
          task.id,
          errorMessage,
          currentAttempts
        );

        // Enqueue the task again for retry
        await this.enqueueRetry(task.id);
        console.log(`Task ${task.id} queued for retry`);
      } else {
        // Max retries reached, mark as failed
        console.log(
          `Task ${task.id} reached max retries (${MAX_RETRIES}), marking as failed`
        );
        await this.repository.markAsFailed(task.id, errorMessage);
        console.log(
          `Task ${task.id} marked as failed after ${currentAttempts} attempts`
        );
      }
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

    // Check if this is chunked audio or single audio file
    if (payload.chunked && payload.chunks) {
      return await this.handleChunkedTranscribe(payload);
    } else {
      return await this.handleSingleTranscribe(payload);
    }
  }

  // Handle transcription of chunked audio
  private async handleChunkedTranscribe(
    payload: TaskPayload
  ): Promise<TaskResult> {
    const { episodeId, chunks, overlapDuration = 2 } = payload;
    if (!episodeId || !chunks || !Array.isArray(chunks)) {
      throw new Error(
        "Episode ID and chunks array are required for chunked transcription"
      );
    }

    console.log(
      `Processing chunked transcribe task: ${chunks.length} chunks for episode ${episodeId}`
    );

    try {
      // Transcribe all chunks in parallel
      console.log("Starting parallel transcription of all chunks...");
      const transcribeChunk = async (chunk: any) => {
        console.log(
          `Transcribing chunk ${chunk.index} (${chunk.startTime}s - ${chunk.endTime}s)`
        );

        try {
          // Fetch the chunk audio file
          const audioResponse = await fetch(chunk.url);
          if (!audioResponse.ok) {
            throw new Error(
              `Failed to fetch chunk ${chunk.index}: ${audioResponse.status} ${audioResponse.statusText}`
            );
          }

          const audioArrayBuffer = await audioResponse.arrayBuffer();
          const audioSize = audioArrayBuffer.byteLength;
          console.log(`Chunk ${chunk.index} audio size:`, audioSize, "bytes");

          // Use Cloudflare Workers AI Whisper model for transcription with retry
          const transcriptResponse = await this.runAIWithRetry(
            audioArrayBuffer
          );

          if (!transcriptResponse || !transcriptResponse.text) {
            throw new Error(
              `Transcription failed for chunk ${chunk.index} - no text returned`
            );
          }

          const transcriptText = transcriptResponse.text.trim();
          console.log(
            `Chunk ${chunk.index} transcription completed: ${transcriptText.length} characters`
          );

          return {
            index: chunk.index,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            duration: chunk.duration,
            text: transcriptText,
            wordCount: transcriptText
              .split(/\s+/)
              .filter((word: string) => word.length > 0).length,
          };
        } catch (error) {
          console.error(`Failed to transcribe chunk ${chunk.index}:`, error);
          throw new Error(
            `Chunk ${chunk.index} transcription failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };

      // Process all chunks in parallel (but limit concurrency to avoid overwhelming the AI service)
      const concurrencyLimit = 3;
      const transcribedChunks = [];

      for (let i = 0; i < chunks.length; i += concurrencyLimit) {
        const batch = chunks.slice(i, i + concurrencyLimit);
        console.log(
          `Processing transcription batch ${
            Math.floor(i / concurrencyLimit) + 1
          }/${Math.ceil(chunks.length / concurrencyLimit)}`
        );
        const batchResults = await Promise.all(batch.map(transcribeChunk));
        transcribedChunks.push(...batchResults);
      }

      // Sort chunks by index to ensure correct order
      transcribedChunks.sort((a, b) => a.index - b.index);

      console.log(
        `All ${transcribedChunks.length} chunks transcribed, merging with overlap processing...`
      );

      // Merge transcriptions with overlap deduplication
      const mergedText = this.mergeTranscriptionsWithOverlapRemoval(
        transcribedChunks,
        overlapDuration
      );

      // Generate a unique filename for the merged transcript
      const transcriptId = uuidv4();
      const transcriptKey = `transcripts/${episodeId}/${transcriptId}.txt`;

      // Store merged transcript in R2
      if (!this.bucket) {
        throw new Error("R2 bucket not available for storing transcript");
      }
      await this.bucket.put(transcriptKey, mergedText, {
        httpMetadata: {
          contentType: "text/plain",
          contentLanguage: "en",
        },
        customMetadata: {
          episodeId,
          createdAt: new Date().toISOString(),
          totalChunks: transcribedChunks.length.toString(),
          overlapDuration: overlapDuration.toString(),
          processingMode: "chunked",
          originalTextLength: transcribedChunks
            .reduce((sum, chunk) => sum + chunk.text.length, 0)
            .toString(),
          mergedTextLength: mergedText.length.toString(),
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
        {
          episodeId,
          transcriptUrl,
          textLength: mergedText.length,
          processingMode: "chunked",
          totalChunks: transcribedChunks.length,
        },
        episodeId
      );

      console.log("Chunked transcription completed:", {
        episodeId,
        transcriptUrl,
        totalChunks: transcribedChunks.length,
        originalTextLength: transcribedChunks.reduce(
          (sum, chunk) => sum + chunk.text.length,
          0
        ),
        mergedTextLength: mergedText.length,
        overlapDuration,
      });

      return {
        transcriptUrl,
        transcriptKey,
        textLength: mergedText.length,
        completedAt: new Date().toISOString(),
        processingMode: "chunked",
        chunkDetails: {
          totalChunks: transcribedChunks.length,
          overlapDuration,
          originalTextLength: transcribedChunks.reduce(
            (sum, chunk) => sum + chunk.text.length,
            0
          ),
          compressionRatio:
            (
              ((transcribedChunks.reduce(
                (sum, chunk) => sum + chunk.text.length,
                0
              ) -
                mergedText.length) /
                transcribedChunks.reduce(
                  (sum, chunk) => sum + chunk.text.length,
                  0
                )) *
              100
            ).toFixed(1) + "%",
        },
        chunks: transcribedChunks.map((chunk) => ({
          index: chunk.index,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          wordCount: chunk.wordCount,
          textLength: chunk.text.length,
        })),
      };
    } catch (error) {
      console.error("Chunked transcription failed:", error);
      throw error;
    }
  }

  // Handle transcription of single audio file (original method)
  private async handleSingleTranscribe(
    payload: TaskPayload
  ): Promise<TaskResult> {
    const { episodeId, audioUrl } = payload;
    if (!episodeId || !audioUrl) {
      throw new Error(
        "Episode ID and audio URL are required for transcription"
      );
    }

    console.log("Processing single file transcribe task:", {
      episodeId,
      audioUrl,
    });

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
      if (!this.bucket) {
        throw new Error("R2 bucket not available for storing transcript");
      }
      await this.bucket.put(transcriptKey, transcriptText, {
        httpMetadata: {
          contentType: "text/plain",
          contentLanguage: "en",
        },
        customMetadata: {
          episodeId,
          createdAt: new Date().toISOString(),
          processingMode: "single",
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

      console.log("Single file transcription completed:", {
        episodeId,
        transcriptUrl,
        textLength: transcriptText.length,
      });

      return {
        transcriptUrl,
        transcriptKey,
        textLength: transcriptText.length,
        completedAt: new Date().toISOString(),
        processingMode: "single",
      };
    } catch (error) {
      console.error("Single file transcription failed:", error);
      throw error;
    }
  }

  // Helper method to merge transcriptions and remove duplicate words in overlaps
  private mergeTranscriptionsWithOverlapRemoval(
    transcribedChunks: any[],
    overlapDuration: number
  ): string {
    if (transcribedChunks.length === 0) {
      return "";
    }

    if (transcribedChunks.length === 1) {
      return transcribedChunks[0].text;
    }

    console.log(
      `Merging ${transcribedChunks.length} transcriptions with ${overlapDuration}s overlap removal`
    );

    let mergedText = transcribedChunks[0].text;

    for (let i = 1; i < transcribedChunks.length; i++) {
      const currentChunk = transcribedChunks[i];
      const previousChunk = transcribedChunks[i - 1];

      // Calculate the overlap region in terms of text
      const overlapStartTime = currentChunk.startTime;
      const overlapEndTime = previousChunk.endTime;
      const actualOverlap = Math.min(
        overlapEndTime - overlapStartTime,
        overlapDuration
      );

      if (actualOverlap > 0) {
        // Split current chunk text into words
        const currentWords = currentChunk.text
          .trim()
          .split(/\s+/)
          .filter((word: string) => word.length > 0);
        const mergedWords = mergedText
          .trim()
          .split(/\s+/)
          .filter((word: string) => word.length > 0);

        // Estimate how many words to skip based on overlap duration
        // Rough estimate: assume average speaking rate of 150 words per minute
        const estimatedWordsPerSecond = 150 / 60; // ~2.5 words per second
        const estimatedOverlapWords = Math.floor(
          actualOverlap * estimatedWordsPerSecond
        );

        // Find the best overlap point by looking for common word sequences
        let bestOverlapIndex = 0;
        let maxMatchScore = 0;

        // Look for the longest common sequence at the end of merged text and start of current chunk
        const searchRange = Math.min(
          estimatedOverlapWords * 2,
          currentWords.length,
          20
        ); // Limit search range

        for (let skipWords = 0; skipWords < searchRange; skipWords++) {
          const currentStartWords = currentWords.slice(
            skipWords,
            skipWords + 10
          ); // Look at next 10 words
          const mergedEndWords = mergedWords.slice(-10); // Last 10 words

          // Calculate match score
          let matchScore = 0;
          const minLength = Math.min(
            currentStartWords.length,
            mergedEndWords.length
          );

          for (let j = 0; j < minLength; j++) {
            const currentWord = currentStartWords[j]
              .toLowerCase()
              .replace(/[^\w]/g, "");
            const mergedWord = mergedEndWords[
              mergedEndWords.length - minLength + j
            ]
              .toLowerCase()
              .replace(/[^\w]/g, "");

            if (currentWord === mergedWord && currentWord.length > 2) {
              matchScore += currentWord.length; // Longer words get higher scores
            }
          }

          if (matchScore > maxMatchScore) {
            maxMatchScore = matchScore;
            bestOverlapIndex = skipWords;
          }
        }

        // If we found a good overlap, use it; otherwise, use estimated overlap
        const finalSkipWords =
          maxMatchScore > 0
            ? bestOverlapIndex
            : Math.min(estimatedOverlapWords, currentWords.length - 1);

        console.log(
          `Chunk ${currentChunk.index}: Skipping ${finalSkipWords} words (overlap: ${actualOverlap}s, match score: ${maxMatchScore})`
        );

        // Append the non-overlapping part of the current chunk
        const nonOverlapWords = currentWords.slice(finalSkipWords);
        if (nonOverlapWords.length > 0) {
          mergedText += " " + nonOverlapWords.join(" ");
        }
      } else {
        // No overlap, just append the entire chunk
        console.log(
          `Chunk ${currentChunk.index}: No overlap, appending entire text`
        );
        mergedText += " " + currentChunk.text;
      }
    }

    // Clean up the merged text
    return mergedText.trim().replace(/\s+/g, " ");
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
      // Use the encoding container for FFmpeg chunking
      console.log(
        "Using encoding container for FFmpeg chunking into 30s segments with 2s overlap..."
      );

      // Get the EncodingContainer instance
      if (!this.encodingContainer) {
        throw new Error("Encoding container not available for preprocessing");
      }

      // Create a unique session ID for this preprocessing task
      const sessionId = `chunk-${Date.now()}`;
      const containerId = this.encodingContainer.idFromName(sessionId);
      const container = this.encodingContainer.get(containerId);

      // Prepare the request for the container with chunking parameters
      const containerRequest = new Request("http://localhost/chunk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioUrl,
          outputFormat: "mp3",
          bitrate: 32, // 32kbps for transcription preprocessing
          chunkDuration: 30, // 30 seconds per chunk
          overlapDuration: 2, // 2 seconds overlap
          streaming: true,
        }),
      });

      // Send the request to the encoding container
      console.log("Sending chunking request to container...");
      const containerResponse = await container.fetch(containerRequest);

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        throw new Error(`Container chunking failed: ${errorText}`);
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

                if (data.type === "progress") {
                  console.log(
                    `Container chunking progress: ${data.progress}% - ${data.message}`
                  );
                } else if (data.type === "complete") {
                  // Store the final result
                  finalResult = data;
                  console.log("Container chunking completed");
                } else if (data.type === "error") {
                  throw new Error(data.error || "Container chunking failed");
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

      if (!finalResult || !finalResult.success || !finalResult.chunks) {
        throw new Error(
          "Container chunking did not complete successfully or no chunks returned"
        );
      }

      console.log(
        `Container chunking result: ${finalResult.chunks.length} chunks created`
      );

      // Store each chunk in R2 and collect chunk URLs
      const chunkUrls = [];
      const bucketName = "podcast-service-assets"; // Default bucket name

      for (const chunk of finalResult.chunks) {
        if (!chunk.encodedData) {
          throw new Error(`No encoded data for chunk ${chunk.index}`);
        }

        // Convert base64 encoded data to Buffer
        const chunkData = Buffer.from(chunk.encodedData, "base64");

        // Generate a unique filename for each chunk
        const chunkId = uuidv4();
        const chunkKey = `preprocessed-chunks/${episodeId}/${chunkId}_chunk_${chunk.index}.mp3`;

        // Store chunk in R2
        await this.bucket.put(chunkKey, chunkData, {
          httpMetadata: {
            contentType: "audio/mpeg",
          },
          customMetadata: {
            episodeId,
            chunkIndex: chunk.index.toString(),
            startTime: chunk.startTime.toString(),
            endTime: chunk.endTime.toString(),
            duration: chunk.duration.toString(),
            totalChunks: finalResult.chunks.length.toString(),
            processedAt: new Date().toISOString(),
            format: "mp3",
            bitrate: "32",
            channels: "1",
          },
        });

        // Generate signed URL for the chunk
        let chunkUrl: string;

        if (this.presignedUrlGenerator) {
          try {
            console.log(
              `Generating presigned URL for chunk ${chunk.index}:`,
              chunkKey
            );
            chunkUrl = await this.presignedUrlGenerator.generatePresignedUrl(
              bucketName,
              chunkKey,
              28800 // 8 hours expiry
            );
          } catch (error) {
            console.warn(
              `Failed to generate signed URL for chunk ${chunk.index}, using fallback:`,
              error
            );
            chunkUrl = `${
              process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
            }/${chunkKey}`;
          }
        } else {
          console.warn(
            "No presigned URL generator available, using public URL"
          );
          chunkUrl = `${
            process.env.R2_ENDPOINT || "https://podcast-media.sesamy.dev"
          }/${chunkKey}`;
        }

        chunkUrls.push({
          index: chunk.index,
          url: chunkUrl,
          key: chunkKey,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          duration: chunk.duration,
          size: chunkData.length,
          metadata: chunk.metadata,
        });
      }

      console.log("Audio chunking completed:", {
        episodeId,
        totalChunks: chunkUrls.length,
        totalDuration: finalResult.totalDuration,
        chunkDuration: finalResult.chunkDuration,
        overlapDuration: finalResult.overlapDuration,
      });

      // Create the transcription task with the chunked audio
      console.log("Creating transcription task with chunked audio...");
      await this.createTask("transcribe", {
        episodeId,
        showId,
        chunks: chunkUrls, // Pass all chunk URLs to transcription
        totalDuration: finalResult.totalDuration,
        chunkDuration: finalResult.chunkDuration,
        overlapDuration: finalResult.overlapDuration,
        chunked: true,
      });

      return {
        chunks: chunkUrls, // Return chunk information
        totalChunks: chunkUrls.length,
        totalDuration: finalResult.totalDuration,
        chunkDuration: finalResult.chunkDuration,
        overlapDuration: finalResult.overlapDuration,
        completedAt: new Date().toISOString(),
        isSignedUrl: !!this.presignedUrlGenerator,
        urlExpiresIn: this.presignedUrlGenerator ? "8 hours" : null,
        containerUsed: true, // chunking now uses the encoding container
        nextTaskCreated: "transcribe",
        processingMode: "chunked",
        metadata: {
          totalOriginalSize: finalResult.chunks.reduce(
            (sum: number, chunk: any) => sum + (chunk.metadata?.size || 0),
            0
          ),
          averageChunkSize:
            chunkUrls.reduce((sum: number, chunk) => sum + chunk.size, 0) /
            chunkUrls.length,
          compressionInfo: "32kbps mono for optimal transcription",
        },
      };
    } catch (error) {
      console.error("Audio chunking failed:", error);
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
                  // Cap container progress at 90% to leave room for post-processing
                  const cappedProgress = Math.min(data.progress * 0.9, 90);
                  await this.updateTaskProgress(taskId, cappedProgress);
                  console.log(
                    `Container progress: ${data.progress}% (capped at ${cappedProgress}%) - ${data.message}`
                  );
                } else if (data.type === "complete") {
                  // Store the final result
                  finalResult = data;
                  console.log(
                    "Container encoding completed, starting post-processing..."
                  );

                  // Update progress to 90% when container completes
                  if (taskId) {
                    await this.updateTaskProgress(taskId, 90);
                  }
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
        console.error("Container encoding failed:", {
          hasFinalResult: !!finalResult,
          success: finalResult?.success,
          error: finalResult?.error,
          taskId,
        });
        throw new Error(
          finalResult?.error ||
            "Container encoding did not complete successfully"
        );
      }

      console.log("Container encoding result:", {
        success: finalResult.success,
        hasEncodedData: !!finalResult.encodedData,
        taskId,
        episodeId,
      });

      // Extract encoded data from container response
      const encodedData = finalResult.encodedData;
      if (!encodedData) {
        throw new Error("No encoded data received from container");
      }

      // Update progress: Processing encoded data
      if (taskId) {
        await this.updateTaskProgress(taskId, 92);
      }

      // Generate a unique key for storing the encoded file
      const encodedId = uuidv4();
      const encodedKey = episodeId
        ? `episodes/${episodeId}/encoded/${encodedId}.${outputFormat}`
        : `test-encoding/${encodedId}.${outputFormat}`;

      // Convert base64 encoded data to Buffer
      const encodedBuffer = Buffer.from(encodedData, "base64");

      // Update progress: Uploading to storage
      if (taskId) {
        await this.updateTaskProgress(taskId, 94);
      }

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

      // Update progress: Generating URLs
      if (taskId) {
        await this.updateTaskProgress(taskId, 96);
      }

      // Generate signed URL for the encoded audio
      let encodedUrl: string;
      const bucketName = "podcast-service-assets"; // Default bucket name

      if (this.presignedUrlGenerator) {
        try {
          console.log(
            "Generating presigned URL for encoded audio:",
            encodedKey
          );
          encodedUrl = await this.presignedUrlGenerator.generatePresignedUrl(
            bucketName,
            encodedKey,
            28800 // 8 hours expiry
          );
          console.log("Generated presigned URL:", encodedUrl);
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

      // Update progress: Publishing events
      if (taskId) {
        await this.updateTaskProgress(taskId, 98);
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

      // Final progress update to 100% before completion
      if (taskId) {
        await this.updateTaskProgress(taskId, 100);
      }

      const result = {
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

      console.log("Encode task completed successfully:", {
        taskId,
        episodeId,
        encodedKey,
        size: encodedBuffer.length,
      });

      return result;
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

      // Call the private handleAudioPreprocess method directly (this now uses chunking)
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
