import { WorkflowRepository } from "./repository.js";
import { TaskRepository } from "../tasks/repository.js";
import type { Workflow } from "../database/schema.js";
import { v4 as uuidv4 } from "uuid";

export interface WorkflowProgressUpdate {
  step: string;
  progress: number;
  message?: string;
  data?: any;
}

export class WorkflowService {
  private repository: WorkflowRepository;
  private taskRepository: TaskRepository;

  constructor(database?: D1Database) {
    this.repository = new WorkflowRepository(database);
    this.taskRepository = new TaskRepository(database);
  }

  async createWorkflow(
    taskId: number,
    workflowName: string,
    params: any,
    workflowBinding?: any // This is the Cloudflare Workflow binding
  ): Promise<{ workflow: Workflow; instanceId: string }> {
    const now = new Date().toISOString();
    const workflowId = uuidv4();

    // Create Cloudflare Workflow instance
    let instanceId: string;

    try {
      if (workflowName === "audio-processing" && workflowBinding) {
        const instance = await (workflowBinding as any).create({
          id: workflowId,
          params: {
            ...params,
            taskId: taskId.toString(), // Pass task ID to the workflow as string
            workflowId, // Pass workflow ID to the workflow
          },
        });
        instanceId = instance.id;
      } else if (workflowName === "import-show" && workflowBinding) {
        const instance = await (workflowBinding as any).create({
          id: workflowId,
          params: {
            ...params,
            taskId: taskId.toString(), // Pass task ID to the workflow as string
            workflowId, // Pass workflow ID to the workflow
          },
        });
        instanceId = instance.id;
      } else if (workflowName === "tts-generation" && workflowBinding) {
        const instance = await (workflowBinding as any).create({
          id: workflowId,
          params: {
            ...params,
            taskId: taskId.toString(), // Pass task ID to the workflow as string
            workflowId, // Pass workflow ID to the workflow
          },
        });
        instanceId = instance.id;
      } else {
        throw new Error(
          `Workflow ${workflowName} not available or binding not provided`
        );
      }
    } catch (error) {
      console.error(`Failed to create ${workflowName} workflow:`, error);
      throw new Error(
        `Failed to create workflow: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Create workflow record in database
    const workflow = await this.repository.create({
      id: workflowId,
      taskId,
      workflowName,
      instanceId,
      status: "queued",
      episodeId: params.episodeId,
      metadata: JSON.stringify(params),
      estimatedProgress: 0,
      estimatedDuration:
        workflowName === "audio-processing"
          ? "5-15 minutes"
          : workflowName === "import-show"
          ? "2-10 minutes"
          : workflowName === "tts-generation"
          ? "1-3 minutes"
          : undefined,
      createdAt: now,
      updatedAt: now,
    });

    return { workflow, instanceId };
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    return await this.repository.findById(id);
  }

  async getWorkflowByTaskId(taskId: number): Promise<Workflow | null> {
    return await this.repository.findByTaskId(taskId);
  }

  async getWorkflowByInstanceId(instanceId: string): Promise<Workflow | null> {
    return await this.repository.findByInstanceId(instanceId);
  }

  async updateWorkflowStatus(
    workflowId: string,
    status: string,
    updates?: {
      error?: string;
      completedAt?: string;
      actualDuration?: number;
      estimatedProgress?: number;
      progress?: string;
      metadata?: any;
    }
  ): Promise<Workflow | null> {
    const updateData = {
      ...updates,
      ...(updates?.metadata && { metadata: JSON.stringify(updates.metadata) }),
      ...(updates?.progress &&
        typeof updates.progress === "object" && {
          progress: JSON.stringify(updates.progress),
        }),
    };

    return await this.repository.updateStatus(workflowId, status, updateData);
  }

  async updateWorkflowProgress(
    workflowId: string,
    progressUpdate: WorkflowProgressUpdate
  ): Promise<void> {
    // Get current progress data
    const workflow = await this.repository.findById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Parse existing progress or create new
    let currentProgress: Record<string, any> = {};
    if (workflow.progress) {
      try {
        currentProgress = JSON.parse(workflow.progress);
      } catch (error) {
        console.warn("Failed to parse existing workflow progress:", error);
      }
    }

    // Update step progress
    currentProgress[progressUpdate.step] = {
      progress: progressUpdate.progress,
      message: progressUpdate.message,
      updatedAt: new Date().toISOString(),
      ...(progressUpdate.data && { data: progressUpdate.data }),
    };

    // Calculate overall estimated progress based on step weights
    const estimatedProgress = this.calculateOverallProgress(currentProgress);

    // Update workflow progress
    await this.repository.updateProgress(
      workflowId,
      estimatedProgress,
      JSON.stringify(currentProgress)
    );

    // Also update the associated task progress
    if (workflow.taskId) {
      await this.taskRepository.updateProgress(
        workflow.taskId,
        estimatedProgress
      );
    }
  }

  async completeWorkflow(
    workflowId: string,
    result?: any,
    actualDuration?: number
  ): Promise<Workflow | null> {
    const completed = await this.repository.markAsCompleted(
      workflowId,
      result,
      actualDuration
    );

    // Mark associated task as done
    if (completed?.taskId) {
      await this.taskRepository.markAsDone(completed.taskId, result || {});
    }

    return completed;
  }

  async failWorkflow(
    workflowId: string,
    error: string,
    actualDuration?: number
  ): Promise<Workflow | null> {
    const failed = await this.repository.markAsFailed(
      workflowId,
      error,
      actualDuration
    );

    // Mark associated task as failed
    if (failed?.taskId) {
      await this.taskRepository.markAsFailed(failed.taskId, error);
    }

    return failed;
  }

  async getWorkflowsByEpisodeId(episodeId: string): Promise<Workflow[]> {
    return await this.repository.findByEpisodeId(episodeId);
  }

  async getWorkflowStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    recentActivity: {
      last24h: number;
      last7d: number;
      last30d: number;
    };
    successRate: number;
  }> {
    return await this.repository.getStats();
  }

  async listWorkflows(
    status?: string,
    limit = 10,
    offset = 0,
    sortBy = "createdAt",
    sortOrder: "asc" | "desc" = "desc"
  ): Promise<Workflow[]> {
    return await this.repository.findByStatus(
      status,
      limit,
      offset,
      sortBy,
      sortOrder
    );
  }

  /**
   * Calculate overall progress based on individual step progress
   * This uses predefined weights for different workflow steps
   */
  private calculateOverallProgress(stepProgress: Record<string, any>): number {
    // Define step weights for audio processing workflow
    const stepWeights = {
      "initialize-workflow": 5,
      "encode-for-processing": 15,
      "prepare-chunk-storage": 5,
      "audio-chunking": 15,
      "transcribe-chunks": 30,
      "audio-encoding": 20,
      "update-episode-encodings": 5,
      "cleanup-resources": 3,
      "finalize-processing": 2,
    };

    let totalWeight = 0;
    let completedWeight = 0;

    for (const [stepName, weight] of Object.entries(stepWeights)) {
      totalWeight += weight;

      if (stepProgress[stepName]) {
        const stepProgressPercent = stepProgress[stepName].progress || 0;
        completedWeight += (weight * stepProgressPercent) / 100;
      }
    }

    return totalWeight > 0
      ? Math.round((completedWeight / totalWeight) * 100)
      : 0;
  }

  /**
   * Handle workflow progress updates from Cloudflare Workflows
   * This would be called by workflow steps to report progress
   */
  async handleWorkflowProgressUpdate(
    instanceId: string,
    step: string,
    progress: number,
    message?: string,
    data?: any
  ): Promise<void> {
    const workflow = await this.repository.findByInstanceId(instanceId);
    if (!workflow) {
      console.warn(`Workflow with instance ID ${instanceId} not found`);
      return;
    }

    await this.updateWorkflowProgress(workflow.id, {
      step,
      progress,
      message,
      data,
    });
  }
}
