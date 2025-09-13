import type { Env } from "./types";

/**
 * Helper class for reporting progress from workflow steps back to tasks
 */
export class WorkflowProgressReporter {
  private env: Env;
  private taskId?: string;
  private workflowId?: string;

  constructor(env: Env, taskId?: string, workflowId?: string) {
    this.env = env;
    this.taskId = taskId;
    this.workflowId = workflowId;
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
      // Make an HTTP request to our own API to update progress
      const baseUrl = this.env.SERVICE_BASE_URL;
      if (!baseUrl) {
        console.warn(
          "SERVICE_BASE_URL not configured, skipping progress update"
        );
        return;
      }

      const progressPayload = {
        taskId: parseInt(this.taskId),
        workflowId: this.workflowId,
        step,
        progress,
        message,
        data,
      };

      const response = await fetch(`${baseUrl}/internal/workflow-progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(progressPayload),
      });

      if (!response.ok) {
        console.error(
          `Failed to report workflow progress: ${response.status} ${response.statusText}`
        );
      } else {
        console.log(
          `Progress reported for step ${step}: ${progress}% (task ${this.taskId})`
        );
      }
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
   * Create a progress callback URL that can be used by containers
   * to report progress back to this workflow
   */
  getProgressCallbackUrl(): string | undefined {
    if (!this.env.SERVICE_BASE_URL || !this.taskId) {
      return undefined;
    }

    return `${this.env.SERVICE_BASE_URL}/internal/workflow-progress`;
  }

  /**
   * Create a progress callback function for containers
   */
  createProgressCallback(step: string) {
    return async (progress: number, additionalData?: any) => {
      await this.reportStepProgress(step, progress, undefined, additionalData);
    };
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
      const baseUrl = this.env.SERVICE_BASE_URL;
      if (!baseUrl) {
        console.warn("SERVICE_BASE_URL not configured, skipping status update");
        return;
      }

      const statusPayload = {
        taskId: parseInt(this.taskId),
        workflowId: this.workflowId,
        status,
        message,
        data,
      };

      const response = await fetch(`${baseUrl}/internal/workflow-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(statusPayload),
      });

      if (!response.ok) {
        console.error(
          `Failed to report workflow status: ${response.status} ${response.statusText}`
        );
      } else {
        console.log(`Status reported: ${status} (task ${this.taskId})`);
      }
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
