import { v4 as uuidv4 } from "uuid";
import { EpisodeRepository } from "./repository";
import { CreateEpisode, UpdateEpisode, Pagination } from "./schemas";
import { EventPublisher } from "../events/publisher";
import { TaskService } from "../tasks/service";

export class EpisodeService {
  constructor(
    private episodeRepository: EpisodeRepository,
    private eventPublisher: EventPublisher,
    private taskService?: TaskService
  ) {}

  async getEpisodesByShowId(showId: string, pagination: Pagination) {
    return await this.episodeRepository.findByShowId(showId, pagination);
  }

  async getEpisodeById(showId: string, episodeId: string) {
    return await this.episodeRepository.findById(showId, episodeId);
  }

  async createEpisode(
    showId: string,
    data: CreateEpisode,
    organizationId: string
  ) {
    const id = uuidv4();
    const episode = await this.episodeRepository.create(showId, {
      ...data,
      id,
      organizationId,
    });

    // Publish event
    await this.eventPublisher.publish("episode.created", episode, episode.id);

    return episode;
  }

  async updateEpisode(showId: string, episodeId: string, data: UpdateEpisode) {
    const episode = await this.episodeRepository.update(
      showId,
      episodeId,
      data
    );

    // Publish event
    await this.eventPublisher.publish("episode.updated", episode, episode.id);

    return episode;
  }

  async publishEpisode(showId: string, episodeId: string) {
    const episode = await this.episodeRepository.publish(showId, episodeId);

    // Publish event
    await this.eventPublisher.publish("episode.published", episode, episode.id);

    return episode;
  }

  async deleteEpisode(showId: string, episodeId: string) {
    const episode = await this.episodeRepository.findById(showId, episodeId);
    if (!episode) {
      return false;
    }

    await this.episodeRepository.delete(showId, episodeId);

    // Publish event
    await this.eventPublisher.publish(
      "episode.deleted",
      { id: episodeId, showId },
      episodeId
    );

    return true;
  }
}
