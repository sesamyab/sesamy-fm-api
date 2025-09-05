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
    return await this.db
      .select()
      .from(shows)
      .limit(limit)
      .offset(offset)
      .orderBy(shows.createdAt);
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(shows)
      .where(eq(shows.id, id))
      .limit(1);

    return result[0] || null;
  }

  async create(data: CreateShow & { id: string }) {
    const now = new Date().toISOString();

    const newShow = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(shows).values(newShow);
    return newShow;
  }

  async update(id: string, data: UpdateShow) {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError("Show not found");
    }

    const updatedShow = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    await this.db
      .update(shows)
      .set({
        ...data,
        updatedAt: updatedShow.updatedAt,
      })
      .where(eq(shows.id, id));

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
