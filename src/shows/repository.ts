import { eq } from "drizzle-orm";
import { getDatabase } from "../database/client";
import { shows } from "../database/schema";
import { CreateShow, UpdateShow, Pagination } from "./schemas";
import { NotFoundError } from "../common/errors";

export class ShowRepository {
  private db;

  constructor(database?: D1Database) {
    this.db = getDatabase(database);
  }

  async findAll({ limit, offset }: Pagination) {
    const results = await this.db
      .select()
      .from(shows)
      .limit(limit)
      .offset(offset)
      .orderBy(shows.createdAt);

    // Parse categories JSON for each show
    return results.map((show) => ({
      ...show,
      categories: show.categories ? JSON.parse(show.categories) : null,
    }));
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(shows)
      .where(eq(shows.id, id))
      .limit(1);

    const show = result[0] || null;
    if (!show) return null;

    // Parse categories JSON
    return {
      ...show,
      categories: show.categories ? JSON.parse(show.categories) : null,
    };
  }

  async create(data: CreateShow & { id: string; organizationId: string }) {
    const now = new Date().toISOString();

    const newShow = {
      ...data,
      categories: data.categories ? JSON.stringify(data.categories) : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(shows).values(newShow);

    // Return with parsed categories
    return {
      ...newShow,
      categories: data.categories || null,
    };
  }

  async update(id: string, data: UpdateShow) {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError("Show not found");
    }

    const updatedAt = new Date().toISOString();

    // Handle categories serialization
    const updateData = {
      ...data,
      categories: data.categories ? JSON.stringify(data.categories) : undefined,
      updatedAt,
    };

    await this.db.update(shows).set(updateData).where(eq(shows.id, id));

    // Return with parsed categories
    const updatedShow = {
      ...existing,
      ...data,
      updatedAt,
    };

    return updatedShow;
  }

  async delete(id: string) {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError("Show not found");
    }

    await this.db.delete(shows).where(eq(shows.id, id));
    return true;
  }
}
