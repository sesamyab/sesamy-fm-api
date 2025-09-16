import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";

// Import types
import type { Env, ImportShowParams } from "./types";
import { ImportShowParamsSchema } from "./types";

// Import step classes
import {
  ValidateAndParseRSSStep,
  CreateShowStep,
  ProcessEpisodeStep,
} from "./step-classes";

export class ImportShowWorkflow extends WorkflowEntrypoint<
  Env,
  ImportShowParams
> {
  private async updateWorkflowStatus(
    taskId?: string,
    status?: string,
    message?: string
  ): Promise<void> {
    if (!taskId) return;

    try {
      const taskIdNum = parseInt(taskId);
      if (isNaN(taskIdNum)) {
        console.error(`Invalid task ID: ${taskId}`);
        return;
      }

      const { TaskService } = await import("../../tasks/service.js");
      const taskService = new TaskService(this.env.DB);

      // Update both status and step message
      if (status && message) {
        await taskService.updateTaskStep(taskIdNum, message);
        const { TaskRepository } = await import("../../tasks/repository.js");
        const taskRepository = new TaskRepository(this.env.DB);
        await taskRepository.updateStatus(taskIdNum, status, {
          step: message,
        });
      } else if (status) {
        const { TaskRepository } = await import("../../tasks/repository.js");
        const taskRepository = new TaskRepository(this.env.DB);
        await taskRepository.updateStatus(taskIdNum, status);
      } else if (message) {
        await taskService.updateTaskStep(taskIdNum, message);
      }
    } catch (error) {
      console.warn("Failed to update task status:", error);
    }
  }

  async run(event: WorkflowEvent<ImportShowParams>, step: WorkflowStep) {
    // Validate parameters
    const params = ImportShowParamsSchema.parse(event.payload);

    console.log("Starting import-show workflow with params:", {
      rssUrl: params.rssUrl,
      taskId: params.taskId,
      maxEpisodes: params.maxEpisodes,
    });

    await this.updateWorkflowStatus(
      params.taskId,
      "running",
      "Starting RSS import"
    );

    try {
      // Step 1: Validate and parse RSS
      const parseStep = new ValidateAndParseRSSStep(this.env);
      const parseResult = await step.do("parse-rss", async () => {
        return await parseStep.execute({
          rssUrl: params.rssUrl,
          maxEpisodes: params.maxEpisodes,
        });
      });

      await this.updateWorkflowStatus(
        params.taskId,
        "running",
        `Parsed RSS: ${parseResult.parsedRSS.title} (${parseResult.totalEpisodes} episodes)`
      );

      // Step 2: Create show
      const createShowStep = new CreateShowStep(this.env);
      const showResult = await step.do("create-show", async () => {
        return await createShowStep.execute({
          title: parseResult.parsedRSS.title,
          description: parseResult.parsedRSS.description,
          imageUrl: parseResult.parsedRSS.imageUrl,
          language: parseResult.parsedRSS.language,
          categories: parseResult.parsedRSS.categories,
          author: parseResult.parsedRSS.author,
        });
      });

      await this.updateWorkflowStatus(
        params.taskId,
        "running",
        `Created show: ${showResult.title} (ID: ${showResult.showId})`
      );

      // Step 3: Process episodes (as separate steps for each episode)
      const episodes = parseResult.parsedRSS.episodes.slice(
        0,
        params.maxEpisodes
      );
      const episodeResults = [];

      for (let i = 0; i < episodes.length; i++) {
        const episode = episodes[i];

        const processEpisodeStep = new ProcessEpisodeStep(this.env);
        const episodeResult = await step.do(
          `process-episode-${i}`,
          async () => {
            return await processEpisodeStep.execute({
              showId: showResult.showId,
              episode: {
                title: episode.title,
                description: episode.description,
                audioUrl: episode.audioUrl,
                imageUrl: episode.imageUrl,
                publishedAt: episode.publishedAt,
              },
              skipExisting: params.skipExistingEpisodes,
            });
          }
        );

        episodeResults.push(episodeResult);

        await this.updateWorkflowStatus(
          params.taskId,
          "running",
          `Processed episode ${i + 1}/${episodes.length}: ${
            episodeResult.title
          }`
        );

        // Add a small delay between episodes to avoid overwhelming the system
        if (i < episodes.length - 1) {
          await step.sleep("delay-between-episodes", 1000); // 1 second delay
        }
      }

      // Final status update
      await this.updateWorkflowStatus(
        params.taskId,
        "completed",
        `Successfully imported show "${showResult.title}" with ${episodeResults.length} episodes`
      );

      return {
        success: true,
        showId: showResult.showId,
        showTitle: showResult.title,
        episodesCreated: episodeResults.length,
        episodes: episodeResults,
      };
    } catch (error) {
      await this.updateWorkflowStatus(
        params.taskId,
        "failed",
        `Workflow failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );

      throw error;
    }
  }
}
