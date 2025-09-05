import { v4 as uuidv4 } from "uuid";
import { R2Bucket } from "@cloudflare/workers-types";
import {
  imageUploads,
  shows,
  episodes,
  NewImageUpload,
  ImageUpload,
} from "../database/schema.js";
import { eq } from "drizzle-orm";
import { getDatabase } from "../database/client.js";
import { R2PreSignedUrlGenerator } from "../audio/service.js";

export class ImageService {
  private r2PreSignedUrlGenerator: R2PreSignedUrlGenerator | null = null;
  private db: any;
  private bucket: R2Bucket;

  constructor(
    bucket?: R2Bucket,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string,
    database?: any
  ) {
    this.bucket = bucket as R2Bucket;
    this.db = getDatabase(database);

    // Initialize pre-signed URL generator if credentials are available
    if (r2AccessKeyId && r2SecretAccessKey) {
      console.log(
        `[ImageService] Initializing R2PreSignedUrlGenerator with endpoint: ${r2Endpoint}`
      );
      this.r2PreSignedUrlGenerator = new R2PreSignedUrlGenerator(
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
    } else {
      console.log(
        `[ImageService] R2 credentials not available - r2AccessKeyId: ${!!r2AccessKeyId}, r2SecretAccessKey: ${!!r2SecretAccessKey}`
      );
    }
  }

  /**
   * Upload image for a show
   */
  async uploadShowImage(showId: string, file: File): Promise<ImageUpload> {
    console.log(`[ImageService] Uploading show image for show ${showId}`);
    console.log(
      `[ImageService] File details: name="${file.name}", size=${file.size}, type="${file.type}"`
    );

    // Validate that R2 bucket is available
    if (!this.bucket) {
      console.error(`[ImageService] R2 bucket is not configured`);
      throw new Error("R2 bucket is not configured");
    }
    console.log(`[ImageService] R2 bucket is available`);

    // Verify show exists
    console.log(`[ImageService] Checking if show exists: ${showId}`);
    const show = await this.db
      .select()
      .from(shows)
      .where(eq(shows.id, showId))
      .get();
    if (!show) {
      console.error(`[ImageService] Show not found: ${showId}`);
      throw new Error(`Show with id ${showId} not found`);
    }
    console.log(`[ImageService] Show found: ${show.title}`);

    // Validate file type
    if (!file.type.startsWith("image/")) {
      console.error(`[ImageService] Invalid file type: ${file.type}`);
      throw new Error("File must be an image");
    }
    console.log(`[ImageService] File type validated: ${file.type}`);

    const fileId = uuidv4();
    const filename = file.name || `image-${fileId}`;
    const key = `images/shows/${showId}/${fileId}/${filename}`;

    console.log(`[ImageService] Generated upload key: ${key}`);

    try {
      console.log(`[ImageService] Converting file to arrayBuffer...`);
      // Upload to R2
      const arrayBuffer = await file.arrayBuffer();
      console.log(
        `[ImageService] ArrayBuffer created, size: ${arrayBuffer.byteLength}`
      );

      console.log(`[ImageService] Attempting R2 upload...`);
      await this.bucket.put(key, arrayBuffer, {
        httpMetadata: {
          contentType: file.type,
        },
      });
      console.log(`[ImageService] R2 upload successful`);

      const r2Url = `r2://${key}`;
      console.log(`[ImageService] Stored as R2 URL: ${r2Url}`);

      console.log(`[ImageService] Saving metadata to database...`);
      // Save metadata to database
      const imageUpload: NewImageUpload = {
        id: fileId,
        showId: showId,
        episodeId: null,
        fileName: filename,
        fileSize: file.size,
        mimeType: file.type,
        url: r2Url,
        uploadedAt: new Date().toISOString(),
      };

      const result = await this.db
        .insert(imageUploads)
        .values(imageUpload)
        .returning()
        .get();

      console.log(
        `[ImageService] Image upload saved to database with id: ${result.id}`
      );

      // Update show's image URL
      await this.db
        .update(shows)
        .set({
          imageUrl: r2Url,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(shows.id, showId));

      console.log(`[ImageService] Updated show ${showId} with new image URL`);

      return result;
    } catch (error: any) {
      console.error(
        `[ImageService] Error uploading image for show ${showId}:`,
        {
          message: error.message,
          name: error.name,
          stack: error.stack,
          cause: error.cause,
          errorString: String(error),
          errorType: typeof error,
        }
      );

      if (error.message?.includes("bucket")) {
        console.error(`[ImageService] R2 bucket error detected`);
        throw new Error("Image storage service is not available");
      }

      if (
        error.message?.includes("database") ||
        error.message?.includes("UNIQUE")
      ) {
        console.error(`[ImageService] Database error detected`);
        throw new Error("Database error occurred while saving image metadata");
      }

      // Re-throw the original error for other cases
      console.error(`[ImageService] Rethrowing unhandled error`);
      throw error;
    }
  }

  /**
   * Upload image for an episode
   */
  async uploadEpisodeImage(
    showId: string,
    episodeId: string,
    file: File
  ): Promise<ImageUpload> {
    console.log(
      `[ImageService] Uploading episode image for episode ${episodeId}`
    );

    // Verify episode exists and belongs to show
    const episode = await this.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .get();

    if (!episode || episode.showId !== showId) {
      throw new Error(
        `Episode with id ${episodeId} not found in show ${showId}`
      );
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      throw new Error("File must be an image");
    }

    const fileId = uuidv4();
    const filename = file.name || `image-${fileId}`;
    const key = `images/episodes/${showId}/${episodeId}/${fileId}/${filename}`;

    console.log(`[ImageService] Uploading to R2 key: ${key}`);

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await this.bucket.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    const r2Url = `r2://${key}`;
    console.log(`[ImageService] Stored as R2 URL: ${r2Url}`);

    // Save metadata to database
    const imageUpload: NewImageUpload = {
      id: fileId,
      showId: null,
      episodeId: episodeId,
      fileName: filename,
      fileSize: file.size,
      mimeType: file.type,
      url: r2Url,
      uploadedAt: new Date().toISOString(),
    };

    const result = await this.db
      .insert(imageUploads)
      .values(imageUpload)
      .returning()
      .get();

    console.log(
      `[ImageService] Image upload saved to database with id: ${result.id}`
    );

    // Update episode's image URL
    await this.db
      .update(episodes)
      .set({
        imageUrl: r2Url,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(episodes.id, episodeId));

    console.log(
      `[ImageService] Updated episode ${episodeId} with new image URL`
    );

    return result;
  }

  /**
   * Sign an R2 URL to make it accessible
   */
  async signImageUrl(url: string): Promise<string> {
    if (!url || !url.startsWith("r2://")) {
      return url;
    }

    if (!this.r2PreSignedUrlGenerator) {
      console.warn("[ImageService] No pre-signed URL generator available");
      return url;
    }

    const key = url.replace("r2://", "");
    return await this.r2PreSignedUrlGenerator.generatePresignedUrl(
      "podcast-assets",
      key
    );
  }
}
