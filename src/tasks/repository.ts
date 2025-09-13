import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, asc, sql, or } from "drizzle-orm";
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

  async findByStatus(
    status?: string,
    limit = 10,
    offset = 0,
    sortBy = "created_at",
    sortOrder = "desc"
  ): Promise<Task[]> {
    // Determine the sort column
    const sortColumn =
      sortBy === "created_at"
        ? tasks.createdAt
        : sortBy === "updated_at"
        ? tasks.updatedAt
        : sortBy === "type"
        ? tasks.type
        : sortBy === "status"
        ? tasks.status
        : tasks.createdAt; // default fallback

    // Determine sort direction
    const orderByColumn =
      sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    if (status) {
      return await this.db
        .select()
        .from(tasks)
        .where(eq(tasks.status, status))
        .orderBy(orderByColumn)
        .limit(limit)
        .offset(offset);
    }

    return await this.db
      .select()
      .from(tasks)
      .orderBy(orderByColumn)
      .limit(limit)
      .offset(offset);
  }

  async findPendingTasks(limit = 5): Promise<Task[]> {
    return await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "pending"))
      .orderBy(tasks.createdAt)
      .limit(limit);
  }

  async findPendingAndRetryTasks(limit = 5): Promise<Task[]> {
    return await this.db
      .select()
      .from(tasks)
      .where(or(eq(tasks.status, "pending"), eq(tasks.status, "retry")))
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
      startedAt?: string;
      progress?: number;
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
    console.log(`Incrementing attempts for task ${id}`);
    const task = await this.findById(id);
    if (!task) {
      console.log(`Task ${id} not found`);
      return null;
    }

    console.log(
      `Task ${id} current status: ${task.status}, attempts: ${
        task.attempts || 0
      }`
    );
    const updatedTask = await this.updateStatus(id, "processing", {
      attempts: (task.attempts || 0) + 1,
    });
    console.log(
      `Task ${id} updated status: ${updatedTask?.status}, attempts: ${updatedTask?.attempts}`
    );

    return updatedTask;
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

  async markAsRetry(
    id: number,
    error: string,
    attempts: number
  ): Promise<Task | null> {
    return await this.updateStatus(id, "retry", {
      error,
      attempts,
    });
  }

  async resetForRetry(id: number): Promise<Task | null> {
    const now = new Date().toISOString();

    const result = await this.db
      .update(tasks)
      .set({
        status: "pending",
        error: null,
        result: null,
        progress: 0,
        startedAt: null,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();

    return result[0] || null;
  }

  async updateProgress(id: number, progress: number): Promise<Task | null> {
    const now = new Date().toISOString();

    const result = await this.db
      .update(tasks)
      .set({
        progress,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();

    return result[0] || null;
  }

  async markAsStarted(id: number): Promise<Task | null> {
    const now = new Date().toISOString();

    const result = await this.db
      .update(tasks)
      .set({
        status: "processing",
        startedAt: now,
        progress: 0,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();

    return result[0] || null;
  }

  async update(
    id: number,
    updates: Partial<Omit<NewTask, "id" | "createdAt">>
  ): Promise<Task | null> {
    const now = new Date().toISOString();

    const result = await this.db
      .update(tasks)
      .set({
        ...updates,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();

    return result[0] || null;
  }
}
