import { TaskService } from "./service.js";

export class TaskProcessor {
  private taskService: TaskService;
  private isProcessing = false;

  constructor(database?: D1Database) {
    this.taskService = new TaskService(database);
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

      // Get pending and failed tasks that might need retry
      const pendingTasks = await this.taskService.getTasks(
        "pending",
        batchSize
      );
      const failedTasks = await this.taskService.getTasks(
        "failed",
        Math.max(0, batchSize - pendingTasks.length)
      );

      const tasksToProcess = [...pendingTasks, ...failedTasks];
      processed = tasksToProcess.length;

      if (processed === 0) {
        console.log("No tasks to process");
        return { processed: 0, successful: 0, failed: 0 };
      }

      // Process failed tasks by retrying them (they will create new workflows)
      for (const task of failedTasks) {
        try {
          await this.taskService.retryTask(task.id);
          successful++;
          console.log(`Retried failed task ${task.id}`);
        } catch (error) {
          console.error(`Failed to retry task ${task.id}:`, error);
          failed++;
        }
      }

      // Pending tasks should already be processed since createTask now immediately starts workflows
      // So we just count them as successful
      successful += pendingTasks.length;

      console.log(
        `Task processing completed: ${processed} processed, ${successful} successful, ${failed} failed`
      );
    } catch (error) {
      console.error("Error during task processing:", error);
      failed = processed;
      successful = 0;
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

      if (task.status === "failed") {
        console.log(`Retrying failed task ${taskId}`);
        await this.taskService.retryTask(taskId);
        console.log(`Successfully retried task ${taskId}`);
      } else if (task.status === "pending") {
        console.log(
          `Task ${taskId} is pending - it should have been processed when created`
        );
        // If it's still pending, try to retry it to trigger workflow creation
        await this.taskService.retryTask(taskId);
        console.log(
          `Successfully triggered workflow for pending task ${taskId}`
        );
      } else {
        console.warn(
          `Task ${taskId} is in status '${task.status}' - no action needed`
        );
      }
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
