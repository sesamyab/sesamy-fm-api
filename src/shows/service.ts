import { v4 as uuidv4 } from "uuid";
import { ShowRepository } from "./repository";
import { CreateShow, UpdateShow, Pagination } from "./schemas";
import { EventPublisher } from "../events/publisher";

export class ShowService {
  constructor(
    private showRepository: ShowRepository,
    private eventPublisher: EventPublisher
  ) {}

  async getAllShows(pagination: Pagination) {
    return await this.showRepository.findAll(pagination);
  }

  async getShowById(id: string) {
    return await this.showRepository.findById(id);
  }

  async createShow(data: CreateShow) {
    const id = uuidv4();
    const show = await this.showRepository.create({
      ...data,
      id,
    });

    // Publish event
    await this.eventPublisher.publish("show.created", show, show.id);

    return show;
  }

  async updateShow(id: string, data: UpdateShow) {
    const show = await this.showRepository.update(id, data);

    // Publish event
    await this.eventPublisher.publish("show.updated", show, show.id);

    return show;
  }

  async deleteShow(id: string) {
    const show = await this.showRepository.findById(id);
    if (!show) {
      return false;
    }

    await this.showRepository.delete(id);

    // Publish event
    await this.eventPublisher.publish("show.deleted", { id }, id);

    return true;
  }
}
