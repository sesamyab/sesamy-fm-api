import { describe, it, expect, beforeEach, vi } from "vitest";
import { CreativeUploadService } from "../src/campaigns/creative-upload-service";
import { CampaignRepository } from "../src/campaigns/repository";
import { EventPublisher } from "../src/events/publisher";

// Mock dependencies
vi.mock("../src/campaigns/repository");
vi.mock("../src/events/publisher");

describe("CreativeUploadService", () => {
  let service: CreativeUploadService;
  let mockCampaignRepo: any;
  let mockEventPublisher: any;
  let mockBucket: any;

  beforeEach(() => {
    mockCampaignRepo = {
      findCreativeById: vi.fn(),
      updateCreative: vi.fn(),
    };

    mockEventPublisher = {
      publish: vi.fn(),
    };

    mockBucket = {
      put: vi.fn(),
    };

    // Mock the CampaignRepository constructor
    (CampaignRepository as any).mockImplementation(() => mockCampaignRepo);
    (EventPublisher as any).mockImplementation(() => mockEventPublisher);

    service = new CreativeUploadService(
      undefined,
      mockBucket,
      mockEventPublisher
    );
  });

  describe("uploadCreativeAudio", () => {
    it("should set audioUrl when uploading audio file", async () => {
      const campaignId = "campaign-1";
      const creativeId = "creative-1";
      const audioFile = {
        fileName: "audio.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg",
        buffer: Buffer.from("fake audio data"),
      };

      mockCampaignRepo.findCreativeById.mockResolvedValue({ id: creativeId });
      mockCampaignRepo.updateCreative.mockResolvedValue({ id: creativeId });
      mockBucket.put.mockResolvedValue(undefined);
      mockEventPublisher.publish.mockResolvedValue(undefined);

      const result = await service.uploadCreativeAudio(
        campaignId,
        creativeId,
        audioFile
      );

      expect(mockCampaignRepo.updateCreative).toHaveBeenCalledWith(
        campaignId,
        creativeId,
        expect.objectContaining({
          audioUrl: expect.stringContaining("r2://creatives/audio/"),
          type: "audio",
        })
      );

      expect(result).toMatchObject({
        campaignId,
        creativeId,
        fileName: audioFile.fileName,
        fileSize: audioFile.fileSize,
        mimeType: audioFile.mimeType,
      });
    });

    it("should reject non-audio files", async () => {
      const campaignId = "campaign-1";
      const creativeId = "creative-1";
      const nonAudioFile = {
        fileName: "image.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg",
        buffer: Buffer.from("fake image data"),
      };

      mockCampaignRepo.findCreativeById.mockResolvedValue({ id: creativeId });

      await expect(
        service.uploadCreativeAudio(campaignId, creativeId, nonAudioFile)
      ).rejects.toThrow("File must be an audio file");
    });
  });

  describe("uploadCreativeImage", () => {
    it("should set imageUrl when uploading image file", async () => {
      const campaignId = "campaign-1";
      const creativeId = "creative-1";
      const imageFile = {
        fileName: "image.jpg",
        fileSize: 2048,
        mimeType: "image/jpeg",
        buffer: Buffer.from("fake image data"),
      };

      mockCampaignRepo.findCreativeById.mockResolvedValue({ id: creativeId });
      mockCampaignRepo.updateCreative.mockResolvedValue({ id: creativeId });
      mockBucket.put.mockResolvedValue(undefined);
      mockEventPublisher.publish.mockResolvedValue(undefined);

      const result = await service.uploadCreativeImage(
        campaignId,
        creativeId,
        imageFile
      );

      expect(mockCampaignRepo.updateCreative).toHaveBeenCalledWith(
        campaignId,
        creativeId,
        expect.objectContaining({
          imageUrl: expect.stringContaining("r2://creatives/image/"),
          type: "display",
        })
      );

      expect(result).toMatchObject({
        campaignId,
        creativeId,
        fileName: imageFile.fileName,
        fileSize: imageFile.fileSize,
        mimeType: imageFile.mimeType,
      });
    });

    it("should reject non-image files", async () => {
      const campaignId = "campaign-1";
      const creativeId = "creative-1";
      const nonImageFile = {
        fileName: "audio.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg",
        buffer: Buffer.from("fake audio data"),
      };

      mockCampaignRepo.findCreativeById.mockResolvedValue({ id: creativeId });

      await expect(
        service.uploadCreativeImage(campaignId, creativeId, nonImageFile)
      ).rejects.toThrow("File must be an image file");
    });
  });

  describe("getCreativeMetadata", () => {
    it("should return both audioUrl and imageUrl when available", async () => {
      const campaignId = "campaign-1";
      const creativeId = "creative-1";
      const mockCreative = {
        id: creativeId,
        campaignId,
        name: "Test Creative",
        type: "display",
        audioUrl: "r2://creatives/audio/test.mp3",
        imageUrl: "r2://creatives/image/test.jpg",
      };

      mockCampaignRepo.findCreativeById.mockResolvedValue(mockCreative);

      const result = await service.getCreativeMetadata(campaignId, creativeId);

      expect(result).toMatchObject({
        id: creativeId,
        audioUrl: mockCreative.audioUrl,
        imageUrl: mockCreative.imageUrl,
      });
    });
  });
});
