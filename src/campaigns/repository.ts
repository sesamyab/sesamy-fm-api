import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { getDatabase } from "../database/client";
import {
  campaigns,
  creatives,
  campaignShows,
  shows,
  type Campaign,
  type NewCampaign,
  type Creative,
  type NewCreative,
} from "../database/schema";
import { Pagination } from "./schemas";
import { NotFoundError } from "../common/errors";

export class CampaignRepository {
  private db;

  constructor(database?: D1Database) {
    this.db = getDatabase(database);
  }

  async findAll(pagination: Pagination, organizationId: string) {
    const offset = (pagination.page - 1) * pagination.limit;

    const [campaignsData, totalCount] = await Promise.all([
      this.db
        .select()
        .from(campaigns)
        .where(eq(campaigns.organizationId, organizationId))
        .orderBy(desc(campaigns.createdAt))
        .limit(pagination.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(campaigns)
        .where(eq(campaigns.organizationId, organizationId))
        .then((result: any) => result[0].count),
    ]);

    return {
      data: campaignsData,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pagination.limit),
      },
    };
  }

  async findById(id: string, organizationId: string): Promise<Campaign | null> {
    const campaign = await this.db
      .select()
      .from(campaigns)
      .where(
        and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId))
      )
      .limit(1);

    return campaign[0] || null;
  }

  async findByIdWithDetails(id: string, organizationId: string) {
    const campaign = await this.findById(id, organizationId);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    // Get creatives for this campaign
    const campaignCreatives = await this.db
      .select()
      .from(creatives)
      .where(eq(creatives.campaignId, id))
      .orderBy(asc(creatives.createdAt));

    // Get shows for this campaign
    const campaignShowsData = await this.db
      .select({
        id: shows.id,
        title: shows.title,
      })
      .from(campaignShows)
      .innerJoin(shows, eq(campaignShows.showId, shows.id))
      .where(eq(campaignShows.campaignId, id))
      .orderBy(asc(shows.title));

    return {
      ...campaign,
      creatives: campaignCreatives,
      shows: campaignShowsData,
    };
  }

  async create(
    data: Omit<NewCampaign, "createdAt" | "updatedAt">
  ): Promise<Campaign> {
    const now = new Date().toISOString();
    const campaignData = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.db
      .insert(campaigns)
      .values(campaignData)
      .returning();

    return result[0];
  }

  async update(
    id: string,
    data: Partial<Omit<NewCampaign, "createdAt" | "updatedAt">>,
    organizationId: string
  ): Promise<Campaign> {
    const now = new Date().toISOString();
    const updateData = {
      ...data,
      updatedAt: now,
    };

    const result = await this.db
      .update(campaigns)
      .set(updateData)
      .where(
        and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId))
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundError("Campaign not found");
    }

    return result[0];
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.db
      .delete(campaigns)
      .where(
        and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId))
      )
      .returning();

    return result.length > 0;
  }

  // Creative methods
  async findCreativesByCampaign(campaignId: string): Promise<Creative[]> {
    return await this.db
      .select()
      .from(creatives)
      .where(eq(creatives.campaignId, campaignId))
      .orderBy(asc(creatives.createdAt));
  }

  async findCreativeById(
    campaignId: string,
    creativeId: string
  ): Promise<Creative | null> {
    const creative = await this.db
      .select()
      .from(creatives)
      .where(
        and(eq(creatives.id, creativeId), eq(creatives.campaignId, campaignId))
      )
      .limit(1);

    return creative[0] || null;
  }

  async createCreative(
    data: Omit<NewCreative, "createdAt" | "updatedAt">
  ): Promise<Creative> {
    const now = new Date().toISOString();
    const creativeData = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.db
      .insert(creatives)
      .values(creativeData)
      .returning();

    return result[0];
  }

  async updateCreative(
    campaignId: string,
    creativeId: string,
    data: Partial<Omit<NewCreative, "createdAt" | "updatedAt">>
  ): Promise<Creative> {
    const now = new Date().toISOString();
    const updateData = {
      ...data,
      updatedAt: now,
    };

    const result = await this.db
      .update(creatives)
      .set(updateData)
      .where(
        and(eq(creatives.id, creativeId), eq(creatives.campaignId, campaignId))
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundError("Creative not found");
    }

    return result[0];
  }

  async deleteCreative(
    campaignId: string,
    creativeId: string
  ): Promise<boolean> {
    const result = await this.db
      .delete(creatives)
      .where(
        and(eq(creatives.id, creativeId), eq(creatives.campaignId, campaignId))
      )
      .returning();

    return result.length > 0;
  }

  // Campaign-Show relationship methods
  async addShowToCampaign(campaignId: string, showId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .insert(campaignShows)
      .values({
        campaignId,
        showId,
        createdAt: now,
      })
      .onConflictDoNothing(); // Prevent duplicate entries
  }

  async removeShowFromCampaign(
    campaignId: string,
    showId: string
  ): Promise<boolean> {
    const result = await this.db
      .delete(campaignShows)
      .where(
        and(
          eq(campaignShows.campaignId, campaignId),
          eq(campaignShows.showId, showId)
        )
      )
      .returning();

    return result.length > 0;
  }

  async updateCampaignShows(
    campaignId: string,
    showIds: string[]
  ): Promise<void> {
    // Remove existing relationships
    await this.db
      .delete(campaignShows)
      .where(eq(campaignShows.campaignId, campaignId));

    // Add new relationships
    if (showIds.length > 0) {
      const now = new Date().toISOString();
      const values = showIds.map((showId) => ({
        campaignId,
        showId,
        createdAt: now,
      }));

      await this.db.insert(campaignShows).values(values);
    }
  }

  async findShowsByCampaign(campaignId: string) {
    return await this.db
      .select({
        id: shows.id,
        title: shows.title,
        description: shows.description,
        imageUrl: shows.imageUrl,
        createdAt: shows.createdAt,
        updatedAt: shows.updatedAt,
      })
      .from(campaignShows)
      .innerJoin(shows, eq(campaignShows.showId, shows.id))
      .where(eq(campaignShows.campaignId, campaignId))
      .orderBy(asc(shows.title));
  }
}
