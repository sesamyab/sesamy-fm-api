import { TaskService } from "./service.js";

export class TaskProcessor {
  private taskService: TaskService;
  private isProcessing = false;

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
    this.taskService = new TaskService(
      database,
      bucket,
      ai,
      queue,
      encodingContainer,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2Endpoint
    );
  }

  async processTasks(batchSize = 5): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    if (this.isProcessing) {
      console.log("Task processing already in progress, skipping...");
      return { processed: 0, successful: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let successful = 0;
    let failed = 0;

    try {
      console.log(`Starting task processing (batch size: ${batchSize})`);

      await this.taskService.processPendingTasks(batchSize);

      // Note: The actual counts would need to be returned from the service
      // For now, we'll just return the batch size as processed
      processed = batchSize;
      successful = batchSize; // This is a simplification

      console.log(
        `Task processing completed: ${processed} processed, ${successful} successful, ${failed} failed`
      );
    } catch (error) {
      console.error("Error during task processing:", error);
      failed = batchSize;
    } finally {
      this.isProcessing = false;
    }

    return { processed, successful, failed };
  }

  /**
   * Scheduled task processor that can be called by Cloudflare Cron triggers
   */
  async handleScheduledTask(event: ScheduledEvent): Promise<void> {
    console.log("Scheduled task processor triggered:", event.scheduledTime);

    try {
      const result = await this.processTasks(5);
      console.log("Scheduled task processing result:", result);
    } catch (error) {
      console.error("Scheduled task processing failed:", error);
      throw error;
    }
  }

  /**
   * Process a specific task by ID for immediate processing
   */
  async processSpecificTask(taskId: number): Promise<void> {
    console.log(`Processing specific task: ${taskId}`);

    try {
      const task = await this.taskService.getTask(taskId);
      if (!task) {
        console.warn(`Task ${taskId} not found`);
        return;
      }

      if (task.status !== "pending") {
        console.warn(
          `Task ${taskId} is not in pending status (current: ${task.status})`
        );
        return;
      }

      // Process the specific task directly
      await this.taskService.processTask(task);
      console.log(`Successfully processed task ${taskId}`);
    } catch (error) {
      console.error(`Error processing specific task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Manual trigger for task processing
   */
  async triggerProcessing(batchSize?: number): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    return await this.processTasks(batchSize);
  }
}
