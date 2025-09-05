import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { tasks, type Task, type NewTask } from "../database/schema.js";
import { getDatabase } from "../database/client.js";

export class TaskRepository {
  private db;

  constructor(database?: D1Database) {
    this.db = getDatabase(database);
  }

  async create(
    task: Omit<NewTask, "id" | "createdAt" | "updatedAt">
  ): Promise<Task> {
    const now = new Date().toISOString();
    const newTask: NewTask = {
      ...task,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.db.insert(tasks).values(newTask).returning();

    return result[0];
  }

  async findById(id: number): Promise<Task | null> {
    const result = await this.db.select().from(tasks).where(eq(tasks.id, id));

    return result[0] || null;
  }

  async findByStatus(status?: string, limit = 10, offset = 0): Promise<Task[]> {
    if (status) {
      return await this.db
        .select()
        .from(tasks)
        .where(eq(tasks.status, status))
        .limit(limit)
        .offset(offset);
    }

    return await this.db.select().from(tasks).limit(limit).offset(offset);
  }

  async findPendingTasks(limit = 5): Promise<Task[]> {
    return await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "pending"))
      .orderBy(tasks.createdAt)
      .limit(limit);
  }

  async updateStatus(
    id: number,
    status: string,
    updates: {
      result?: string;
      error?: string;
      attempts?: number;
    } = {}
  ): Promise<Task | null> {
    const now = new Date().toISOString();

    const result = await this.db
      .update(tasks)
      .set({
        status,
        updatedAt: now,
        ...updates,
      })
      .where(eq(tasks.id, id))
      .returning();

    return result[0] || null;
  }

  async incrementAttempts(id: number): Promise<Task | null> {
    const task = await this.findById(id);
    if (!task) return null;

    return await this.updateStatus(id, "processing", {
      attempts: (task.attempts || 0) + 1,
    });
  }

  async markAsDone(id: number, result?: any): Promise<Task | null> {
    return await this.updateStatus(id, "done", {
      result: result ? JSON.stringify(result) : undefined,
    });
  }

  async markAsFailed(id: number, error: string): Promise<Task | null> {
    return await this.updateStatus(id, "failed", {
      error,
    });
  }
}
