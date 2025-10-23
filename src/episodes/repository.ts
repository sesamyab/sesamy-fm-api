import { eq, and } from "drizzle-orm";
import { getDatabase } from "../database/client";
import { episodes } from "../database/schema";
import { CreateEpisode, UpdateEpisode, Pagination } from "./schemas";
import { NotFoundError } from "../common/errors";

export class EpisodeRepository {
  private db;

  constructor(database?: D1Database) {
    this.db = getDatabase(database);
  }

  async findByShowId(showId: string, { limit, offset }: Pagination) {
    return await this.db
      .select()
      .from(episodes)
      .where(eq(episodes.showId, showId))
      .limit(limit)
      .offset(offset)
      .orderBy(episodes.createdAt);
  }

  async findById(showId: string, episodeId: string) {
    const result = await this.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, showId), eq(episodes.id, episodeId)))
      .limit(1);

    return result[0] || null;
  }

  async findByIdOnly(episodeId: string) {
    const result = await this.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);

    return result[0] || null;
  }

  async create(
    showId: string,
    data: CreateEpisode & { id: string; organizationId: string }
  ) {
    const now = new Date().toISOString();

    const newEpisode = {
      ...data,
      showId,
      published: false,
      publishedAt: null,
      adMarkers: data.adMarkers ? JSON.stringify(data.adMarkers) : null,
      chapters: data.chapters ? JSON.stringify(data.chapters) : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(episodes).values(newEpisode);
    return newEpisode;
  }

  async update(showId: string, episodeId: string, data: UpdateEpisode) {
    const existing = await this.findById(showId, episodeId);
    if (!existing) {
      throw new NotFoundError("Episode not found");
    }

    const updatedEpisode = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    // Stringify JSON fields if they're provided as arrays
    const dataToSet: any = { ...data };
    if (data.adMarkers !== undefined) {
      dataToSet.adMarkers = data.adMarkers
        ? JSON.stringify(data.adMarkers)
        : null;
    }
    if (data.chapters !== undefined) {
      dataToSet.chapters = data.chapters ? JSON.stringify(data.chapters) : null;
    }

    await this.db
      .update(episodes)
      .set({
        ...dataToSet,
        updatedAt: updatedEpisode.updatedAt,
      })
      .where(and(eq(episodes.showId, showId), eq(episodes.id, episodeId)));

    return updatedEpisode;
  }

  async updateByIdOnly(episodeId: string, data: UpdateEpisode) {
    const existing = await this.findByIdOnly(episodeId);
    if (!existing) {
      throw new NotFoundError("Episode not found");
    }

    const updatedEpisode = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    // Stringify JSON fields if they're provided as arrays
    const dataToSet: any = { ...data };
    if (data.adMarkers !== undefined) {
      dataToSet.adMarkers = data.adMarkers
        ? JSON.stringify(data.adMarkers)
        : null;
    }
    if (data.chapters !== undefined) {
      dataToSet.chapters = data.chapters ? JSON.stringify(data.chapters) : null;
    }

    await this.db
      .update(episodes)
      .set({
        ...dataToSet,
        updatedAt: updatedEpisode.updatedAt,
      })
      .where(eq(episodes.id, episodeId));

    return updatedEpisode;
  }

  async publish(showId: string, episodeId: string) {
    const existing = await this.findById(showId, episodeId);
    if (!existing) {
      throw new NotFoundError("Episode not found");
    }

    const now = new Date().toISOString();
    const updatedEpisode = {
      ...existing,
      published: true,
      publishedAt: now,
      updatedAt: now,
    };

    await this.db
      .update(episodes)
      .set({
        published: true,
        publishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(episodes.showId, showId), eq(episodes.id, episodeId)));

    return updatedEpisode;
  }

  async delete(showId: string, episodeId: string) {
    const existing = await this.findById(showId, episodeId);
    if (!existing) {
      throw new NotFoundError("Episode not found");
    }

    await this.db
      .delete(episodes)
      .where(and(eq(episodes.showId, showId), eq(episodes.id, episodeId)));

    return true;
  }
}
