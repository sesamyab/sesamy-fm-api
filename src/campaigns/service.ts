import { v4 as uuidv4 } from "uuid";
import { CampaignRepository } from "./repository";
import {
  CreateCampaign,
  UpdateCampaign,
  Pagination,
  CreateCreative,
  UpdateCreative,
} from "./schemas";
import { EventPublisher } from "../events/publisher";
import { NotFoundError } from "../common/errors";

export class CampaignService {
  constructor(
    private campaignRepository: CampaignRepository,
    private eventPublisher: EventPublisher
  ) {}

  async getAllCampaigns(pagination: Pagination) {
    return await this.campaignRepository.findAll(pagination);
  }

  async getCampaignById(id: string) {
    return await this.campaignRepository.findById(id);
  }

  async getCampaignByIdWithDetails(id: string) {
    return await this.campaignRepository.findByIdWithDetails(id);
  }

  async createCampaign(data: CreateCampaign) {
    const id = uuidv4();
    const { showIds, ...campaignData } = data;

    // Create the campaign - all required fields must be present
    const campaign = await this.campaignRepository.create({
      id,
      name: campaignData.name,
      startDate: campaignData.startDate,
      endDate: campaignData.endDate,
      priority: campaignData.priority ?? 5,
      status: campaignData.status ?? "draft",
      advertiser: campaignData.advertiser ?? null,
      targetImpressions: campaignData.targetImpressions ?? null,
    } as any);

    // Link campaign to shows
    if (showIds && showIds.length > 0) {
      await this.campaignRepository.updateCampaignShows(id, showIds);
    }

    // Publish event
    await this.eventPublisher.publish(
      "campaign.created",
      campaign,
      campaign.id
    );

    return campaign;
  }

  async updateCampaign(id: string, data: UpdateCampaign) {
    const { showIds, ...campaignData } = data;

    // Update the campaign
    const campaign = await this.campaignRepository.update(id, campaignData);

    // Update campaign-show relationships if showIds provided
    if (showIds !== undefined) {
      await this.campaignRepository.updateCampaignShows(id, showIds);
    }

    // Publish event
    await this.eventPublisher.publish(
      "campaign.updated",
      campaign,
      campaign.id
    );

    return campaign;
  }

  async deleteCampaign(id: string) {
    const campaign = await this.campaignRepository.findById(id);
    if (!campaign) {
      return false;
    }

    const deleted = await this.campaignRepository.delete(id);

    if (deleted) {
      // Publish event
      await this.eventPublisher.publish("campaign.deleted", { id }, id);
    }

    return deleted;
  }

  // Creative management methods
  async getCampaignCreatives(campaignId: string) {
    // Verify campaign exists
    const campaign = await this.campaignRepository.findById(campaignId);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    return await this.campaignRepository.findCreativesByCampaign(campaignId);
  }

  async getCreativeById(campaignId: string, creativeId: string) {
    return await this.campaignRepository.findCreativeById(
      campaignId,
      creativeId
    );
  }

  async createCreative(
    campaignId: string,
    data: Omit<CreateCreative, "campaignId">
  ) {
    // Verify campaign exists
    const campaign = await this.campaignRepository.findById(campaignId);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    const id = uuidv4();
    const creative = await this.campaignRepository.createCreative({
      id,
      campaignId,
      name: data.name,
      type: data.type ?? "audio",
      duration: data.duration,
      placementType: data.placementType ?? "any",
      language: data.language ?? null,
    } as any);

    // Publish event
    await this.eventPublisher.publish(
      "creative.created",
      creative,
      creative.id
    );

    return creative;
  }

  async updateCreative(
    campaignId: string,
    creativeId: string,
    data: UpdateCreative
  ) {
    const creative = await this.campaignRepository.updateCreative(
      campaignId,
      creativeId,
      data
    );

    // Publish event
    await this.eventPublisher.publish(
      "creative.updated",
      creative,
      creative.id
    );

    return creative;
  }

  async deleteCreative(campaignId: string, creativeId: string) {
    const creative = await this.campaignRepository.findCreativeById(
      campaignId,
      creativeId
    );
    if (!creative) {
      return false;
    }

    const deleted = await this.campaignRepository.deleteCreative(
      campaignId,
      creativeId
    );

    if (deleted) {
      // Publish event
      await this.eventPublisher.publish(
        "creative.deleted",
        { id: creativeId, campaignId },
        creativeId
      );
    }

    return deleted;
  }

  // Campaign-Show relationship methods
  async getCampaignShows(campaignId: string) {
    // Verify campaign exists
    const campaign = await this.campaignRepository.findById(campaignId);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    return await this.campaignRepository.findShowsByCampaign(campaignId);
  }

  async addShowToCampaign(campaignId: string, showId: string) {
    // Verify campaign exists
    const campaign = await this.campaignRepository.findById(campaignId);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    await this.campaignRepository.addShowToCampaign(campaignId, showId);

    // Publish event
    await this.eventPublisher.publish(
      "campaign.show.added",
      { campaignId, showId },
      campaignId
    );

    return true;
  }

  async removeShowFromCampaign(campaignId: string, showId: string) {
    const removed = await this.campaignRepository.removeShowFromCampaign(
      campaignId,
      showId
    );

    if (removed) {
      // Publish event
      await this.eventPublisher.publish(
        "campaign.show.removed",
        { campaignId, showId },
        campaignId
      );
    }

    return removed;
  }
}
