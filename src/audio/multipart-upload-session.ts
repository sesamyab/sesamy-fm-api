import { DurableObject } from "cloudflare:workers";
import type { CloudflareEnv } from "../types/env";

export interface MultipartUploadState {
  uploadId: string;
  episodeId: string;
  showId: string;
  audioId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  r2Key: string;
  r2UploadId: string;
  totalChunks: number;
  uploadedParts: Array<{ partNumber: number; etag: string }>;
  createdAt: number;
}

/**
 * Durable Object for managing persistent multipart upload session state.
 * Each upload gets its own Durable Object instance, ensuring:
 * - State survives worker restarts
 * - Strong consistency for concurrent chunk uploads
 * - Automatic cleanup via alarms
 */
export class MultipartUploadSession extends DurableObject<CloudflareEnv> {
  private static readonly EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Handle incoming requests (RPC-style interface)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1); // Remove leading /

    try {
      switch (action) {
        case "initialize": {
          const state = (await request.json()) as MultipartUploadState;
          await this.initialize(state);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        case "getState": {
          const state = await this.getState();
          return new Response(JSON.stringify(state), {
            headers: { "Content-Type": "application/json" },
          });
        }

        case "addPart": {
          const { partNumber, etag } = (await request.json()) as {
            partNumber: number;
            etag: string;
          };
          const result = await this.addPart(partNumber, etag);
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        }

        case "delete": {
          await this.delete();
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  /**
   * Initialize or retrieve the upload session state
   */
  private async initialize(state: MultipartUploadState): Promise<void> {
    await this.ctx.storage.put("state", state);

    // Set an alarm for automatic cleanup after 24 hours
    const expiryTime = Date.now() + MultipartUploadSession.EXPIRY_MS;
    await this.ctx.storage.setAlarm(expiryTime);
  }

  /**
   * Get the current upload session state
   */
  private async getState(): Promise<MultipartUploadState | null> {
    const state = await this.ctx.storage.get<MultipartUploadState>("state");
    return state ?? null;
  }

  /**
   * Add or update an uploaded part (handles retries)
   */
  private async addPart(
    partNumber: number,
    etag: string
  ): Promise<{ received: number; total: number }> {
    const state = await this.ctx.storage.get<MultipartUploadState>("state");
    if (!state) {
      throw new Error("Upload session not found");
    }

    // Validate partNumber is within valid bounds
    if (partNumber < 1 || partNumber > state.totalChunks) {
      throw new Error(
        `Invalid part number: ${partNumber}. Must be between 1 and ${state.totalChunks}`
      );
    }

    // Validate etag is non-empty
    if (!etag || etag.trim().length === 0) {
      throw new Error("ETag cannot be empty");
    }

    // Find and replace existing part, or add new one
    const existingIndex = state.uploadedParts.findIndex(
      (p) => p.partNumber === partNumber
    );
    if (existingIndex !== -1) {
      state.uploadedParts[existingIndex] = { partNumber, etag };
    } else {
      state.uploadedParts.push({ partNumber, etag });
    }

    await this.ctx.storage.put("state", state);

    return {
      received: state.uploadedParts.length,
      total: state.totalChunks,
    };
  }

  /**
   * Delete the upload session (called after successful completion or abort)
   */
  private async delete(): Promise<void> {
    await this.ctx.storage.deleteAll();
    // Cancel any pending alarm
    await this.ctx.storage.deleteAlarm();
  }

  /**
   * Alarm handler for automatic cleanup of expired sessions
   * Now has access to the R2 bucket via this.env
   */
  async alarm(): Promise<void> {
    try {
      const state = await this.ctx.storage.get<MultipartUploadState>("state");
      if (!state) {
        console.log("Alarm triggered but no state found - already cleaned up");
        return; // Already cleaned up
      }

      const age = Date.now() - state.createdAt;
      if (age >= MultipartUploadSession.EXPIRY_MS) {
        console.log(
          `Cleaning up expired upload session: ${
            state.uploadId
          } (age: ${Math.round(age / 1000 / 60)} minutes)`
        );

        // Abort the R2 multipart upload
        try {
          const r2Upload = this.env.BUCKET.resumeMultipartUpload(
            state.r2Key,
            state.r2UploadId
          );
          await r2Upload.abort();
          console.log(
            `Aborted R2 multipart upload for session: ${state.uploadId}`
          );
        } catch (r2Error) {
          // Log but don't fail - the R2 upload might already be completed/aborted
          console.error(
            `Failed to abort R2 upload for session ${state.uploadId}:`,
            r2Error instanceof Error ? r2Error.message : r2Error
          );
        }

        await this.delete();
        console.log(
          `Successfully cleaned up upload session: ${state.uploadId}`
        );
      } else {
        console.log(
          `Upload session ${state.uploadId} not yet expired (age: ${Math.round(
            age / 1000 / 60
          )} minutes)`
        );
      }
    } catch (error) {
      console.error(
        "Error in alarm handler for multipart upload session:",
        error
      );
      // Log the error but don't throw to prevent alarm retry loops
      // The alarm will be rescheduled if the session still exists
    }
  }
}
