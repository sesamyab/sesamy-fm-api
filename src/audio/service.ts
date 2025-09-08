/// <reference types="@cloudflare/workers-types" />

import { v4 as uuidv4 } from "uuid";
import { AudioRepository } from "./repository";
import { EventPublisher } from "../events/publisher";
import { EpisodeRepository } from "../episodes/repository";
import { TaskService } from "../tasks/service";
import { NotFoundError } from "../common/errors";

// AWS Signature Version 4 implementation for R2 pre-signed URLs
export class R2PreSignedUrlGenerator {
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;
  private service: string;
  private endpoint?: string;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    endpoint?: string,
    region = "auto"
  ) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.service = "s3";
    this.endpoint = endpoint;
  }

  async generatePresignedUrl(
    bucketName: string,
    key: string,
    expiresIn: number = 28800 // 8 hours in seconds
  ): Promise<string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);

    // Use custom domain or R2 endpoint
    let host: string;
    if (this.endpoint) {
      // Remove https:// if present and use the provided endpoint/custom domain
      host = this.endpoint.replace(/^https?:\/\//, "");
      console.log(`Using custom endpoint: ${this.endpoint} -> host: ${host}`);
    } else {
      host = `${bucketName}.r2.cloudflarestorage.com`;
      console.log(`Using default R2 endpoint: ${host}`);
    }

    const method = "GET";

    // Create canonical request
    const canonicalUri = `/${key}`;
    const canonicalQuerystring = this.buildCanonicalQueryString({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${dateStamp}/${this.region}/${this.service}/aws4_request`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": expiresIn.toString(),
      "X-Amz-SignedHeaders": "host",
    });

    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = "host";
    const payloadHash = "UNSIGNED-PAYLOAD";

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // Create string to sign
    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const canonicalRequestHash = await this.sha256Hash(canonicalRequest);

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");

    // Calculate signature
    const signature = await this.calculateSignature(stringToSign, dateStamp);

    // Build the final URL
    const finalQuerystring =
      canonicalQuerystring + `&X-Amz-Signature=${signature}`;

    return `https://${host}${canonicalUri}?${finalQuerystring}`;
  }

  private buildCanonicalQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      .join("&");
  }

  private async sha256Hash(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async hmacSha256(
    key: Uint8Array,
    message: string
  ): Promise<Uint8Array> {
    // Create a clean ArrayBuffer to avoid SharedArrayBuffer type issues
    const keyBuffer = new ArrayBuffer(key.length);
    const keyView = new Uint8Array(keyBuffer);
    keyView.set(key);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(message)
    );
    return new Uint8Array(signature);
  }

  private async calculateSignature(
    stringToSign: string,
    dateStamp: string
  ): Promise<string> {
    const encoder = new TextEncoder();

    // Create signing key
    const kDate = await this.hmacSha256(
      encoder.encode(`AWS4${this.secretAccessKey}`),
      dateStamp
    );
    const kRegion = await this.hmacSha256(kDate, this.region);
    const kService = await this.hmacSha256(kRegion, this.service);
    const kSigning = await this.hmacSha256(kService, "aws4_request");

    // Calculate final signature
    const signature = await this.hmacSha256(kSigning, stringToSign);

    return Array.from(signature)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

export class AudioService {
  private audioRepo: AudioRepository;
  private eventPublisher: EventPublisher;
  private episodeRepo: EpisodeRepository;
  private taskService?: TaskService;
  private bucket: R2Bucket;
  private presignedUrlGenerator: R2PreSignedUrlGenerator | null = null;

  constructor(
    database?: D1Database,
    bucket?: R2Bucket,
    eventPublisher?: EventPublisher,
    r2AccessKeyId?: string,
    r2SecretAccessKey?: string,
    r2Endpoint?: string,
    taskService?: TaskService
  ) {
    this.audioRepo = new AudioRepository(database);
    this.episodeRepo = new EpisodeRepository(database);
    this.eventPublisher = eventPublisher || new EventPublisher();
    this.taskService = taskService;
    this.bucket = bucket as R2Bucket;

    // Initialize pre-signed URL generator if credentials are available
    if (r2AccessKeyId && r2SecretAccessKey) {
      console.log(
        `Initializing R2PreSignedUrlGenerator with endpoint: ${r2Endpoint}`
      );
      this.presignedUrlGenerator = new R2PreSignedUrlGenerator(
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Endpoint
      );
    } else {
      console.log(
        `R2 credentials not available - r2AccessKeyId: ${!!r2AccessKeyId}, r2SecretAccessKey: ${!!r2SecretAccessKey}`
      );
    }
  }

  async uploadAudio(
    showId: string,
    episodeId: string,
    file: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      buffer: Buffer;
    }
  ) {
    // Verify episode exists
    const episode = await this.episodeRepo.findById(showId, episodeId);
    if (!episode) {
      throw new NotFoundError("Episode not found");
    }

    const audioId = uuidv4();
    const fileName = file.fileName;
    const key = `audio/${showId}/${episodeId}/${audioId}/${fileName}`;

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

      // Generate pre-signed URL for immediate use and episode update
      if (this.presignedUrlGenerator) {
        try {
          signedUrl = await this.presignedUrlGenerator.generatePresignedUrl(
            "podcast-service-assets",
            key,
            28800 // 8 hours
          );
        } catch (error) {
          console.warn(
            "Failed to generate pre-signed URL, using r2:// fallback:",
            error
          );
          signedUrl = url;
        }
      } else {
        console.warn("No R2 credentials available for pre-signed URLs");
        signedUrl = url;
      }
    } else {
      // Fallback for development/testing
      url = `https://storage.example.com/audio/${audioId}/${fileName}`;
      signedUrl = url;
    }

    // Save audio metadata with R2 key
    const audioUpload = await this.audioRepo.create({
      id: audioId,
      episodeId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url, // Store R2 key (r2://) for regenerating signed URLs
    });

    // Update episode with R2 key (NOT signed URL)
    await this.episodeRepo.update(showId, episodeId, {
      audioUrl: url, // Store R2 key, sign on-demand when reading
    });

    // Publish event with R2 key (generate signed URL for event payload)
    await this.eventPublisher.publish(
      "audio.uploaded",
      {
        ...audioUpload,
        url: signedUrl, // Include signed URL in event for immediate use
      },
      audioUpload.id
    );

    // Enqueue tasks for uploaded audio
    if (this.taskService) {
      console.log(
        `Creating tasks for uploaded audio: episodeId=${episodeId}, audioId=${audioId}`
      );

      // Create encoding task
      await this.taskService.createTask("encode", {
        audioId,
        episodeId,
        showId,
        audioUrl: signedUrl, // Use signed URL for encoding service access
      });
      console.log(`Created encode task for episode ${episodeId}`);

      // Create audio preprocessing task (which will then create transcription task)
      await this.taskService.createTask("audio_preprocess", {
        episodeId,
        showId,
        audioUrl: signedUrl, // Use signed URL for preprocessing
      });
      console.log(`Created audio preprocessing task for episode ${episodeId}`);
    } else if (typeof (globalThis as any).TASK_QUEUE !== "undefined") {
      console.log(
        `Using queue for tasks: episodeId=${episodeId}, audioId=${audioId}`
      );

      // Fallback to queue-based approach
      await (globalThis as any).TASK_QUEUE.send({
        type: "encode",
        payload: {
          audioId,
          episodeId,
          showId,
          audioUrl: signedUrl, // Use signed URL for encoding service access
        },
      });

      // Also enqueue audio preprocessing task for uploaded audio
      await (globalThis as any).TASK_QUEUE.send({
        type: "audio_preprocess",
        payload: {
          episodeId,
          showId,
          audioUrl: signedUrl, // Use signed URL for preprocessing
        },
      });
      console.log(
        `Sent encode and audio preprocessing tasks to queue for episode ${episodeId}`
      );
    } else {
      console.warn(
        `No task processing available - TaskService: ${!!this
          .taskService}, Queue: ${typeof (globalThis as any).TASK_QUEUE}`
      );
    }

    // Return upload info with signed URL for immediate use
    return {
      ...audioUpload,
      url: signedUrl,
    };
  }

  async getAudioMetadata(showId: string, episodeId: string) {
    const audioData = await this.audioRepo.findByEpisodeId(showId, episodeId);

    if (!audioData) {
      return null;
    }

    // Generate fresh pre-signed URL if we have the generator and URL contains an R2 key
    if (this.presignedUrlGenerator && audioData.url.startsWith("r2://")) {
      const key = audioData.url.replace("r2://", "");
      try {
        const signedUrl = await this.presignedUrlGenerator.generatePresignedUrl(
          "podcast-service-assets",
          key,
          28800 // 8 hours
        );

        return {
          ...audioData,
          url: signedUrl,
        };
      } catch (error) {
        console.warn("Failed to generate fresh pre-signed URL:", error);
      }
    }

    return audioData;
  }

  async getR2Object(key: string): Promise<R2Object | null> {
    if (!this.bucket) {
      throw new Error("R2 bucket not available");
    }

    try {
      const object = await this.bucket.get(key);
      return object;
    } catch (error) {
      console.error("Error getting R2 object:", error);
      return null;
    }
  }

  // Utility method to generate signed URL from R2 key
  async generateSignedUrlFromKey(r2Key: string): Promise<string | null> {
    if (!this.presignedUrlGenerator) {
      return null;
    }

    try {
      return await this.presignedUrlGenerator.generatePresignedUrl(
        "podcast-service-assets",
        r2Key,
        28800 // 8 hours
      );
    } catch (error) {
      console.warn("Failed to generate pre-signed URL for key:", r2Key, error);
      return null;
    }
  }
}
