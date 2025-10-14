import { TaskRepository } from "./repository.js";
import { WorkflowService } from "../workflows/service.js";
import type { Task } from "../database/schema.js";

export type TaskType = "audio_processing" | "import_show" | "tts_generation";

export interface TaskPayload {
  [key: string]: any;
}

export interface TaskResult {
  [key: string]: any;
}

export class TaskService {
  private repository: TaskRepository;
  private workflowService: WorkflowService;
  private audioProcessingWorkflow?: Workflow; // This is the Cloudflare Workflow binding
  private importShowWorkflow?: Workflow; // This is the Cloudflare Workflow binding
  private ttsGenerationWorkflow?: Workflow; // This is the Cloudflare Workflow binding

  constructor(
    database?: D1Database,
    audioProcessingWorkflow?: Workflow,
    importShowWorkflow?: Workflow,
    ttsGenerationWorkflow?: Workflow
  ) {
    this.repository = new TaskRepository(database);
    this.workflowService = new WorkflowService(database);
    this.audioProcessingWorkflow = audioProcessingWorkflow;
    this.importShowWorkflow = importShowWorkflow;
    this.ttsGenerationWorkflow = ttsGenerationWorkflow;
    console.log(
      `TaskService initialized with workflows: audio=${!!audioProcessingWorkflow}, import=${!!importShowWorkflow}, tts=${!!ttsGenerationWorkflow}`
    );
  }

  async createTask(
    type: TaskType,
    payload?: TaskPayload,
    organizationId?: string
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task = await this.repository.create({
      type,
      status: "pending",
      attempts: 0,
      organizationId,
      createdAt: now,
      updatedAt: now,
      payload: payload ? JSON.stringify(payload) : undefined,
    } as any);

    // Immediately process workflow-enabled tasks
    try {
      if (type === "audio_processing" && payload) {
        console.log(`Creating workflow for audio_processing task ${task.id}`);
        await this.handleAudioProcessing({ ...payload, taskId: task.id });
      } else if (type === "import_show" && payload) {
        console.log(`Creating workflow for import_show task ${task.id}`);
        await this.handleImportShow({ ...payload, taskId: task.id });
      } else if (type === "tts_generation" && payload) {
        console.log(`Creating workflow for tts_generation task ${task.id}`);
        await this.handleTtsGeneration({ ...payload, taskId: task.id });
      } else {
        console.log(`Task ${task.id} created, will be processed in batch`);
      }
    } catch (error) {
      console.error(`Failed to start workflow for task ${task.id}:`, error);
      await this.repository.update(task.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return task;
  }

  async getTask(id: number, organizationId?: string): Promise<Task | null> {
    if (organizationId) {
      return await this.repository.findByIdAndOrganization(id, organizationId);
    }
    return await this.repository.findById(id);
  }

  async getTasks(
    status?: string,
    limit = 10,
    offset = 0,
    sortBy = "created_at",
    sortOrder = "desc",
    organizationId?: string
  ): Promise<Task[]> {
    return await this.repository.findByStatus(
      status,
      limit,
      offset,
      sortBy,
      sortOrder,
      organizationId
    );
  }

  async retryTask(id: number, organizationId?: string): Promise<Task> {
    const task = organizationId
      ? await this.repository.findByIdAndOrganization(id, organizationId)
      : await this.repository.findById(id);
    if (!task) {
      throw new Error("Task not found");
    }

    // Reset the task status to pending and clear errors
    const retriedTask = await this.repository.resetForRetry(id);
    if (!retriedTask) {
      throw new Error("Failed to reset task for retry");
    }

    // For workflow-enabled task types, immediately retry workflow creation
    try {
      if (retriedTask.type === "audio_processing" && retriedTask.payload) {
        const payload = JSON.parse(retriedTask.payload);
        console.log(
          `Retrying workflow for audio_processing task ${retriedTask.id}`
        );
        await this.handleAudioProcessing({
          ...payload,
          taskId: retriedTask.id,
        });
        await this.repository.update(retriedTask.id, { status: "running" });
      } else {
        console.log(
          `Task ${retriedTask.id} reset to pending, will be processed in next batch`
        );
      }
    } catch (error) {
      console.error(
        `Failed to retry workflow for task ${retriedTask.id}:`,
        error
      );
      await this.repository.update(retriedTask.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return retriedTask;
  }

  // Method for task handlers to update progress
  async updateTaskProgress(
    taskId: number,
    progress: number,
    message?: string
  ): Promise<Task | null> {
    console.log(`Updating task ${taskId} progress to ${progress}%`);
    const updates: any = { progress };
    if (message) {
      updates.result = JSON.stringify({ message, progress });
      updates.step = message; // Also update the step field with the message
    }
    return await this.repository.updateStatus(taskId, "processing", updates);
  }

  // Method for workflows to update task status
  async updateTaskStatus(
    taskId: number,
    status: string,
    options: { message?: string } = {}
  ): Promise<Task | null> {
    console.log(`Updating task ${taskId} status to ${status}`);
    const updates: any = {};
    if (options.message) {
      if (status === "failed") {
        updates.error = options.message;
      } else {
        updates.result = JSON.stringify({ message: options.message, status });
      }
    }
    return await this.repository.updateStatus(taskId, status, updates);
  }

  private async handleAudioProcessing(payload: TaskPayload): Promise<void> {
    console.log(
      `handleAudioProcessing called with workflow: ${!!this
        .audioProcessingWorkflow}`
    );
    if (!this.audioProcessingWorkflow) {
      console.error("Audio processing workflow is null/undefined");
      throw new Error("Audio processing workflow not available");
    }

    const { taskId, episodeId, audioR2Key } = payload;
    if (!episodeId || !audioR2Key) {
      throw new Error(
        "Episode ID and audio R2 key are required for audio processing"
      );
    }

    console.log(
      `Creating audio processing workflow for episode ${episodeId} (task ${taskId})`
    );

    try {
      // Update task status to "processing" (in progress) before starting workflow
      if (taskId) {
        await this.repository.updateStatus(taskId, "processing", {
          startedAt: new Date().toISOString(),
        });
        console.log(`Task ${taskId} status updated to processing`);
      }

      // Create workflow through the workflow service
      const { workflow, instanceId } =
        await this.workflowService.createWorkflow(
          taskId || 0,
          "audio-processing",
          {
            ...payload,
            workflowId: undefined, // Will be set by the workflow service
          },
          this.audioProcessingWorkflow
        );

      console.log(
        `Audio processing workflow created: ${workflow.id} (instance: ${instanceId})`
      );

      // Update task with workflow information
      if (taskId) {
        await this.repository.update(taskId, {
          workflowId: workflow.id,
          workflowInstanceId: instanceId,
        });
      }
    } catch (error) {
      console.error("Failed to create audio processing workflow:", error);
      throw error;
    }
  }

  private async handleImportShow(payload: TaskPayload): Promise<void> {
    console.log(
      `handleImportShow called with workflow: ${!!this.importShowWorkflow}`
    );
    if (!this.importShowWorkflow) {
      console.error("Import show workflow is null/undefined");
      throw new Error("Import show workflow not available");
    }

    const { taskId, rssUrl } = payload;
    if (!rssUrl) {
      throw new Error("RSS URL is required for import show");
    }

    console.log(
      `Creating import show workflow for RSS ${rssUrl} (task ${taskId})`
    );

    try {
      // Update task status to "processing" (in progress) before starting workflow
      if (taskId) {
        await this.repository.updateStatus(taskId, "processing", {
          startedAt: new Date().toISOString(),
        });
        console.log(`Task ${taskId} status updated to processing`);
      }

      // Create workflow through the workflow service
      const { workflow, instanceId } =
        await this.workflowService.createWorkflow(
          taskId || 0,
          "import-show",
          {
            ...payload,
            workflowId: undefined, // Will be set by the workflow service
          },
          this.importShowWorkflow
        );

      console.log(
        `Import show workflow created: ${workflow.id} (instance: ${instanceId})`
      );

      // Update task with workflow information
      if (taskId) {
        await this.repository.update(taskId, {
          workflowId: workflow.id,
          workflowInstanceId: instanceId,
        });
      }
    } catch (error) {
      console.error("Failed to create import show workflow:", error);
      throw error;
    }
  }

  async updateTaskStep(
    taskId: number,
    step: string,
    progress?: number
  ): Promise<void> {
    try {
      await this.repository.updateStep(taskId, step, progress);
      console.log(
        `Task ${taskId} step updated to: ${step}${
          progress !== undefined ? ` (${progress}%)` : ""
        }`
      );
    } catch (error) {
      console.error(`Failed to update task ${taskId} step:`, error);
      throw error;
    }
  }

  private async handleTtsGeneration(payload: TaskPayload): Promise<void> {
    console.log(
      `handleTtsGeneration called with workflow: ${!!this.ttsGenerationWorkflow}`
    );
    if (!this.ttsGenerationWorkflow) {
      console.error("TTS generation workflow is null/undefined");
      throw new Error("TTS generation workflow not available");
    }

    const { taskId, episodeId, scriptUrl } = payload;
    if (!episodeId || !scriptUrl) {
      throw new Error(
        "Episode ID and script URL are required for TTS generation"
      );
    }

    console.log(
      `Creating TTS generation workflow for episode ${episodeId} (task ${taskId})`
    );

    try {
      // Update task status to "processing" (in progress) before starting workflow
      if (taskId) {
        await this.repository.updateStatus(taskId, "processing", {
          startedAt: new Date().toISOString(),
        });
        console.log(`Task ${taskId} status updated to processing`);
      }

      // Create workflow through the workflow service
      const { workflow, instanceId } =
        await this.workflowService.createWorkflow(
          taskId || 0,
          "tts-generation",
          {
            ...payload,
            workflowId: undefined, // Will be set by the workflow service
          },
          this.ttsGenerationWorkflow
        );

      console.log(
        `TTS generation workflow created: ${workflow.id} (instance: ${instanceId})`
      );

      // Update task with workflow information
      if (taskId) {
        await this.repository.update(taskId, {
          workflowId: workflow.id,
          workflowInstanceId: instanceId,
        });
      }
    } catch (error) {
      console.error("Failed to create TTS generation workflow:", error);
      throw error;
    }
  }
}
