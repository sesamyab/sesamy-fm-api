import { v4 as uuidv4 } from "uuid";
import { CampaignRepository } from "./repository";
import { EventPublisher } from "../events/publisher";
import { NotFoundError } from "../common/errors";
import { R2PreSignedUrlGenerator } from "../utils/r2-presigned-url";

export interface CreativeUploadData {
  id: string;
  campaignId: string;
  creativeId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  uploadedAt: string;
}

export class CreativeUploadService {
  private campaignRepo: CampaignRepository;
  private eventPublisher: EventPublisher;
  private bucket: R2Bucket;
  private presignedUrlGenerator: R2PreSignedUrlGenerator | null = null;
  private database?: D1Database;

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    eventPublisher?: EventPublisher,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string
  ) {
    this.database = database;
    this.campaignRepo = new CampaignRepository(database);
    this.eventPublisher = eventPublisher || new EventPublisher();
    this.bucket = bucket as R2Bucket;

    // Initialize R2 credentials for signed URL generation
    if (r2AccessKeyId && r2SecretAccessKey && r2Endpoint) {
      try {
        this.presignedUrlGenerator = new R2PreSignedUrlGenerator(
          r2AccessKeyId,
          r2SecretAccessKey,
          r2Endpoint
        );
        console.log("R2PreSignedUrlGenerator initialized successfully");
      } catch (error) {
        console.warn("Failed to initialize R2PreSignedUrlGenerator:", error);
        this.presignedUrlGenerator = null;
      }
    } else {
      console.warn(
        "R2 credentials not provided, signed URL generation will be limited"
      );
    }
  }

  async uploadCreativeAudio(
    campaignId: string,
    creativeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    // Verify creative exists
    const creative = await this.campaignRepo.findCreativeById(
      campaignId,
      creativeId
    );
    if (!creative) {
      throw new NotFoundError("Creative not found");
    }

    // Validate file type for audio
    if (!file.mimeType.startsWith("audio/")) {
      throw new Error("File must be an audio file");
    }

    const uploadId = uuidv4();
    const fileName = file.fileName;
    const key = `creatives/audio/${campaignId}/${creativeId}/${uploadId}/${fileName}`;

    let url: string;
    let signedUrl: string;

    if (this.bucket) {
      // Upload to R2 bucket
      await this.bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.mimeType,
        },
      });

      // Store the R2 key with a special prefix for database storage
      url = `r2://${key}`;

      // Generate URL for immediate use
      if (this.presignedUrlGenerator) {
        try {
          // Use direct URL with custom domain if available
          const directUrl = this.presignedUrlGenerator.generateDirectUrl(
            "podcast-service-assets",
            key
          );
          signedUrl = directUrl || url; // Fall back to r2:// URL if no custom domain
        } catch (error) {
          console.warn("Failed to generate URL, using r2:// fallback:", error);
          signedUrl = url;
        }
      } else {
        console.warn("No R2 credentials available for URL generation");
        signedUrl = url;
      }
    } else {
      // Fallback for development/testing
      url = `https://storage.example.com/creatives/audio/${campaignId}/${creativeId}/${uploadId}/${fileName}`;
      signedUrl = url;
    }

    // Update creative with the new file URL
    try {
      console.log(`Updating creative ${creativeId} with audio URL`);
      await this.campaignRepo.updateCreative(campaignId, creativeId, {
        audioUrl: url, // Store R2 key for audio files
        type: "audio", // Ensure type is set to audio
      });
      console.log(`Creative updated successfully`);
    } catch (error) {
      console.error("Failed to update creative:", error);
      throw new Error(
        `Database error: Failed to update creative - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Create upload record for tracking
    const creativeUpload: CreativeUploadData = {
      id: uploadId,
      campaignId,
      creativeId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url, // Store R2 key (r2://) for regenerating signed URLs
      uploadedAt: new Date().toISOString(),
    };

    // Publish event with R2 key (generate signed URL for event payload)
    try {
      console.log(`Publishing creative.audio.uploaded event`);
      await this.eventPublisher.publish(
        "creative.audio.uploaded",
        {
          ...creativeUpload,
          url: signedUrl, // Include signed URL in event for immediate use
        },
        creativeUpload.id
      );
      console.log(`Event published successfully`);
    } catch (error) {
      console.error("Failed to publish event:", error);
      throw new Error(
        `Event error: Failed to publish creative.audio.uploaded event - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Return upload info with signed URL for immediate use
    return {
      ...creativeUpload,
      url: signedUrl,
    };
  }

  async uploadCreativeVideo(
    campaignId: string,
    creativeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    // Verify creative exists
    const creative = await this.campaignRepo.findCreativeById(
      campaignId,
      creativeId
    );
    if (!creative) {
      throw new NotFoundError("Creative not found");
    }

    // Validate file type for video
    if (!file.mimeType.startsWith("video/")) {
      throw new Error("File must be a video file");
    }

    const uploadId = uuidv4();
    const fileName = file.fileName;
    const key = `creatives/video/${campaignId}/${creativeId}/${uploadId}/${fileName}`;

    let url: string;
    let signedUrl: string;

    if (this.bucket) {
      // Upload to R2 bucket
      await this.bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.mimeType,
        },
      });

      // Store the R2 key with a special prefix for database storage
      url = `r2://${key}`;

      // Generate URL for immediate use
      if (this.presignedUrlGenerator) {
        try {
          // Use direct URL with custom domain if available
          const directUrl = this.presignedUrlGenerator.generateDirectUrl(
            "podcast-service-assets",
            key
          );
          signedUrl = directUrl || url; // Fall back to r2:// URL if no custom domain
        } catch (error) {
          console.warn("Failed to generate URL, using r2:// fallback:", error);
          signedUrl = url;
        }
      } else {
        console.warn("No R2 credentials available for URL generation");
        signedUrl = url;
      }
    } else {
      // Fallback for development/testing
      url = `https://storage.example.com/creatives/video/${campaignId}/${creativeId}/${uploadId}/${fileName}`;
      signedUrl = url;
    }

    // Update creative with the new file URL
    try {
      console.log(`Updating creative ${creativeId} with video URL`);
      await this.campaignRepo.updateCreative(campaignId, creativeId, {
        audioUrl: url, // Store R2 key for video files (treating video as audio content)
        type: "video", // Ensure type is set to video
      });
      console.log(`Creative updated successfully`);
    } catch (error) {
      console.error("Failed to update creative:", error);
      throw new Error(
        `Database error: Failed to update creative - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Create upload record for tracking
    const creativeUpload: CreativeUploadData = {
      id: uploadId,
      campaignId,
      creativeId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url, // Store R2 key (r2://) for regenerating signed URLs
      uploadedAt: new Date().toISOString(),
    };

    // Publish event with R2 key (generate signed URL for event payload)
    try {
      console.log(`Publishing creative.video.uploaded event`);
      await this.eventPublisher.publish(
        "creative.video.uploaded",
        {
          ...creativeUpload,
          url: signedUrl, // Include signed URL in event for immediate use
        },
        creativeUpload.id
      );
      console.log(`Event published successfully`);
    } catch (error) {
      console.error("Failed to publish event:", error);
      throw new Error(
        `Event error: Failed to publish creative.video.uploaded event - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Return upload info with signed URL for immediate use
    return {
      ...creativeUpload,
      url: signedUrl,
    };
  }

  async uploadCreativeImage(
    campaignId: string,
    creativeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    // Verify creative exists
    const creative = await this.campaignRepo.findCreativeById(
      campaignId,
      creativeId
    );
    if (!creative) {
      throw new NotFoundError("Creative not found");
    }

    // Validate file type for image
    if (!file.mimeType.startsWith("image/")) {
      throw new Error("File must be an image file");
    }

    const uploadId = uuidv4();
    const fileName = file.fileName;
    const key = `creatives/image/${campaignId}/${creativeId}/${uploadId}/${fileName}`;

    let url: string;
    let signedUrl: string;

    if (this.bucket) {
      // Upload to R2 bucket
      await this.bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.mimeType,
        },
      });

      // Store the R2 key with a special prefix for database storage
      url = `r2://${key}`;

      // Generate URL for immediate use
      if (this.presignedUrlGenerator) {
        try {
          // Use direct URL with custom domain if available
          const directUrl = this.presignedUrlGenerator.generateDirectUrl(
            "podcast-service-assets",
            key
          );
          signedUrl = directUrl || url; // Fall back to r2:// URL if no custom domain
        } catch (error) {
          console.warn("Failed to generate URL, using r2:// fallback:", error);
          signedUrl = url;
        }
      } else {
        console.warn("No R2 credentials available for URL generation");
        signedUrl = url;
      }
    } else {
      // Fallback for development/testing
      url = `https://storage.example.com/creatives/image/${campaignId}/${creativeId}/${uploadId}/${fileName}`;
      signedUrl = url;
    }

    // Update creative with the new file URL
    try {
      console.log(`Updating creative ${creativeId} with image URL`);
      await this.campaignRepo.updateCreative(campaignId, creativeId, {
        imageUrl: url, // Store R2 key for image files
      });
      console.log(`Creative updated successfully`);
    } catch (error) {
      console.error("Failed to update creative:", error);
      throw new Error(
        `Database error: Failed to update creative - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Create upload record for tracking
    const creativeUpload: CreativeUploadData = {
      id: uploadId,
      campaignId,
      creativeId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url, // Store R2 key (r2://) for regenerating signed URLs
      uploadedAt: new Date().toISOString(),
    };

    // Publish event with R2 key (generate signed URL for event payload)
    try {
      console.log(`Publishing creative.image.uploaded event`);
      await this.eventPublisher.publish(
        "creative.image.uploaded",
        {
          ...creativeUpload,
          url: signedUrl, // Include signed URL in event for immediate use
        },
        creativeUpload.id
      );
      console.log(`Event published successfully`);
    } catch (error) {
      console.error("Failed to publish event:", error);
      throw new Error(
        `Event error: Failed to publish creative.image.uploaded event - ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Return upload info with signed URL for immediate use
    return {
      ...creativeUpload,
      url: signedUrl,
    };
  }

  async getCreativeMetadata(campaignId: string, creativeId: string) {
    const creative = await this.campaignRepo.findCreativeById(
      campaignId,
      creativeId
    );
    if (!creative) {
      throw new NotFoundError("Creative not found");
    }

    let signedAudioUrl = creative.audioUrl;
    let signedImageUrl = creative.imageUrl;

    // Generate signed URL for audio if we have an R2 key and the generator is available
    if (
      this.presignedUrlGenerator &&
      creative.audioUrl &&
      creative.audioUrl.startsWith("r2://")
    ) {
      try {
        const directUrl = this.presignedUrlGenerator.generateDirectUrl(
          "podcast-service-assets",
          creative.audioUrl.replace("r2://", "")
        );
        signedAudioUrl = directUrl || creative.audioUrl;
      } catch (error) {
        console.warn("Failed to generate signed audio URL:", error);
      }
    }

    // Generate signed URL for image if we have an R2 key and the generator is available
    if (
      this.presignedUrlGenerator &&
      creative.imageUrl &&
      creative.imageUrl.startsWith("r2://")
    ) {
      try {
        const directUrl = this.presignedUrlGenerator.generateDirectUrl(
          "podcast-service-assets",
          creative.imageUrl.replace("r2://", "")
        );
        signedImageUrl = directUrl || creative.imageUrl;
      } catch (error) {
        console.warn("Failed to generate signed image URL:", error);
      }
    }

    return {
      ...creative,
      audioUrl: signedAudioUrl,
      imageUrl: signedImageUrl,
    };
  }
}
