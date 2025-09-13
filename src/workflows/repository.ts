import { drizzle } from "drizzle-orm/d1";
import { eq, desc, asc, and } from "drizzle-orm";
import {
  workflows,
  type Workflow,
  type NewWorkflow,
} from "../database/schema.js";

export class WorkflowRepository {
  private db: ReturnType<typeof drizzle>;

  constructor(database?: D1Database) {
    if (database) {
      this.db = drizzle(database);
    } else {
      // Create a mock db for testing purposes
      this.db = {} as any;
    }
  }

  async create(workflow: NewWorkflow): Promise<Workflow> {
    const [result] = await this.db
      .insert(workflows)
      .values(workflow)
      .returning();
    return result;
  }

  async findById(id: string): Promise<Workflow | null> {
    const result = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id))
      .limit(1);

    return result[0] || null;
  }

  async findByTaskId(taskId: number): Promise<Workflow | null> {
    const result = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.taskId, taskId))
      .limit(1);

    return result[0] || null;
  }

  async findByInstanceId(instanceId: string): Promise<Workflow | null> {
    const result = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.instanceId, instanceId))
      .limit(1);

    return result[0] || null;
  }

  async findByStatus(
    status?: string,
    limit = 10,
    offset = 0,
    sortBy = "createdAt",
    sortOrder: "asc" | "desc" = "desc"
  ): Promise<Workflow[]> {
    let baseQuery = this.db.select().from(workflows);

    if (status) {
      baseQuery = baseQuery.where(
        eq(workflows.status, status)
      ) as typeof baseQuery;
    }

    const orderFn = sortOrder === "desc" ? desc : asc;
    const sortColumn =
      sortBy === "createdAt" ? workflows.createdAt : workflows.updatedAt;

    return await baseQuery
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  }

  async updateStatus(
    id: string,
    status: string,
    updates?: {
      error?: string;
      completedAt?: string;
      actualDuration?: number;
      estimatedProgress?: number;
      progress?: string;
      metadata?: string;
    }
  ): Promise<Workflow | null> {
    const updateData = {
      status,
      updatedAt: new Date().toISOString(),
      ...updates,
    };

    const [result] = await this.db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, id))
      .returning();

    return result || null;
  }

  async updateProgress(
    id: string,
    estimatedProgress: number,
    progress?: string
  ): Promise<void> {
    await this.db
      .update(workflows)
      .set({
        estimatedProgress,
        progress,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, id));
  }

  async markAsCompleted(
    id: string,
    result?: any,
    actualDuration?: number
  ): Promise<Workflow | null> {
    const completedAt = new Date().toISOString();
    const updateData = {
      status: "completed",
      estimatedProgress: 100,
      completedAt,
      updatedAt: completedAt,
      ...(actualDuration && { actualDuration }),
      ...(result && { metadata: JSON.stringify(result) }),
    };

    const [updated] = await this.db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, id))
      .returning();

    return updated || null;
  }

  async markAsFailed(
    id: string,
    error: string,
    actualDuration?: number
  ): Promise<Workflow | null> {
    const completedAt = new Date().toISOString();
    const updateData = {
      status: "failed",
      error,
      completedAt,
      updatedAt: completedAt,
      ...(actualDuration && { actualDuration }),
    };

    const [updated] = await this.db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, id))
      .returning();

    return updated || null;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.db.delete(workflows).where(eq(workflows.id, id));

    return (result as any).changes > 0;
  }

  async findByEpisodeId(episodeId: string): Promise<Workflow[]> {
    return await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.episodeId, episodeId))
      .orderBy(desc(workflows.createdAt));
  }

  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    recentActivity: {
      last24h: number;
      last7d: number;
      last30d: number;
    };
    successRate: number;
  }> {
    // Get all workflows for basic stats
    const allWorkflows = await this.db.select().from(workflows);

    const total = allWorkflows.length;
    const byStatus = allWorkflows.reduce((acc, workflow) => {
      acc[workflow.status] = (acc[workflow.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Calculate recent activity
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentActivity = {
      last24h: allWorkflows.filter((w) => new Date(w.createdAt) >= last24h)
        .length,
      last7d: allWorkflows.filter((w) => new Date(w.createdAt) >= last7d)
        .length,
      last30d: allWorkflows.filter((w) => new Date(w.createdAt) >= last30d)
        .length,
    };

    // Calculate success rate
    const completed = byStatus.completed || 0;
    const failed = byStatus.failed || 0;
    const totalFinished = completed + failed;
    const successRate =
      totalFinished > 0 ? (completed / totalFinished) * 100 : 0;

    return {
      total,
      byStatus,
      recentActivity,
      successRate,
    };
  }
}
