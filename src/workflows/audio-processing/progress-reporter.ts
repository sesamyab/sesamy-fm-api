import type { Env } from "./types";
import { TaskService } from "../../tasks/service.js";
import { TaskRepository } from "../../tasks/repository.js";

/**
 * Helper class for reporting progress from workflow steps back to tasks
 */
export class WorkflowProgressReporter {
  private env: Env;
  private taskId?: string;
  private workflowId?: string;
  private taskService: TaskService;
  private taskRepository: TaskRepository;

  constructor(env: Env, taskId?: string, workflowId?: string) {
    this.env = env;
    this.taskId = taskId;
    this.workflowId = workflowId;
    this.taskService = new TaskService(env.DB);
    this.taskRepository = new TaskRepository(env.DB);
  }

  /**
   * Report progress for a specific step
   */
  async reportStepProgress(
    step: string,
    progress: number,
    message?: string,
    data?: any
  ): Promise<void> {
    if (!this.taskId) {
      console.warn("No task ID provided, skipping progress update");
      return;
    }

    try {
      const taskIdNum = parseInt(this.taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${this.taskId}`);
        return;
      }

      const stepMessage = message || `${step}: ${progress}%`;

      // Update task progress and step using Drizzle directly
      await this.taskService.updateTaskStep(taskIdNum, stepMessage, progress);

      // Update task result with step data if provided
      if (data) {
        const resultData = {
          step,
          progress,
          message: stepMessage,
          data,
          workflowId: this.workflowId,
          timestamp: new Date().toISOString(),
        };

        await this.taskRepository.updateStatus(taskIdNum, "processing", {
          result: JSON.stringify(resultData),
        });
      }

      console.log(
        `Progress reported for step ${step}: ${progress}% (task ${this.taskId})`
      );
    } catch (error) {
      console.error("Error reporting workflow progress:", error);
    }
  }

  /**
   * Report step completion
   */
  async reportStepComplete(
    step: string,
    message?: string,
    data?: any
  ): Promise<void> {
    await this.reportStepProgress(step, 100, message, data);
  }

  /**
   * Report step completion with result data stored in task
   */
  async reportStepCompleteWithResult(
    step: string,
    message: string,
    resultData: any
  ): Promise<void> {
    await this.reportStepProgress(step, 100, message, resultData);
  }

  /**
   * Report step failure
   */
  async reportStepError(
    step: string,
    error: string,
    data?: any
  ): Promise<void> {
    await this.reportStepProgress(step, 0, `Error: ${error}`, data);
  }

  /**
   * Report encoding progress (for containers that can report incremental progress)
   */
  async reportEncodingProgress(
    format: string,
    progress: number,
    data?: any
  ): Promise<void> {
    await this.reportStepProgress(
      "audio-encoding",
      progress,
      `Encoding ${format}: ${progress}%`,
      { format, ...data }
    );
  }

  /**
   * Report workflow status change
   */
  async reportWorkflowStatus(
    status: string,
    message?: string,
    data?: any
  ): Promise<void> {
    if (!this.taskId) {
      console.warn("No task ID provided, skipping status update");
      return;
    }

    try {
      const taskIdNum = parseInt(this.taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${this.taskId}`);
        return;
      }

      // Prepare the update data
      const updateData: any = {};
      if (message) {
        updateData.step = message;
      }

      // Update task result with status data if provided
      if (data) {
        const resultData = {
          status,
          message,
          data,
          workflowId: this.workflowId,
          timestamp: new Date().toISOString(),
        };
        updateData.result = JSON.stringify(resultData);
      }

      // Update task status using Drizzle directly
      await this.taskRepository.updateStatus(taskIdNum, status, updateData);

      console.log(`Status reported: ${status} (task ${this.taskId})`);
    } catch (error) {
      console.error("Error reporting workflow status:", error);
    }
  }
}

/**
 * Enhanced progress reporter that can handle container disconnection detection
 */
export class ContainerProgressReporter extends WorkflowProgressReporter {
  private connectionActive: boolean = true;
  private jobId?: string;

  constructor(env: Env, taskId?: string, workflowId?: string, jobId?: string) {
    super(env, taskId, workflowId);
    this.jobId = jobId;
  }

  /**
   * Mark the connection as inactive (client disconnected)
   */
  markDisconnected(): void {
    this.connectionActive = false;
    console.log(`Container job ${this.jobId} marked as disconnected`);
  }

  /**
   * Check if the connection is still active
   */
  isConnected(): boolean {
    return this.connectionActive;
  }

  /**
   * Create a progress callback that can detect disconnections
   */
  createDisconnectionAwareCallback(step: string) {
    return async (progress: number, additionalData?: any): Promise<boolean> => {
      if (!this.connectionActive) {
        console.log(
          `Progress callback aborted - client disconnected (step: ${step})`
        );
        return false; // Signal to abort the operation
      }

      try {
        await this.reportStepProgress(
          step,
          progress,
          undefined,
          additionalData
        );
        return true; // Continue operation
      } catch (error) {
        console.error(`Progress callback failed for step ${step}:`, error);
        this.markDisconnected();
        return false; // Abort on error
      }
    };
  }
}
