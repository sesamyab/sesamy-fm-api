import { v4 as uuidv4 } from "uuid";
import { ShowRepository } from "./repository";
import { CreateShow, UpdateShow, Pagination } from "./schemas";
import { EventPublisher } from "../events/publisher";

export class ShowService {
  constructor(
    private showRepository: ShowRepository,
    private eventPublisher: EventPublisher
  ) {}

  async getAllShows(pagination: Pagination, organizationId: string) {
    return await this.showRepository.findAll(pagination, organizationId);
  }

  async getShowById(id: string, organizationId: string) {
    return await this.showRepository.findById(id, organizationId);
  }

  // Public method for RSS feeds - gets show by ID without organization context
  async getShowByIdPublic(id: string) {
    return await this.showRepository.findByIdPublic(id);
  }

  async createShow(data: CreateShow, organizationId: string) {
    const id = uuidv4();
    const show = await this.showRepository.create({
      ...data,
      id,
      organizationId,
    });

    // Publish event
    await this.eventPublisher.publish("show.created", show, show.id);

    return show;
  }

  async updateShow(id: string, data: UpdateShow, organizationId: string) {
    const show = await this.showRepository.update(id, data, organizationId);

    // Publish event
    await this.eventPublisher.publish("show.updated", show, show.id);

    return show;
  }

  async deleteShow(id: string, organizationId: string) {
    const show = await this.showRepository.findById(id, organizationId);
    if (!show) {
      return false;
    }

    await this.showRepository.delete(id, organizationId);

    // Publish event
    await this.eventPublisher.publish("show.deleted", { id }, id);

    return true;
  }
}
