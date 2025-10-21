/// <reference types="@cloudflare/workers-types" />

import { AwsClient } from "aws4fetch";

// AWS Signature Version 4 implementation for R2 pre-signed URLs using aws4fetch
export class R2PreSignedUrlGenerator {
  private client: AwsClient;
  private customDomain?: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    customDomain?: string,
    region = "auto"
  ) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region,
      service: "s3",
    });
    this.customDomain = customDomain;
  }

  async generatePresignedUrl(
    bucketName: string,
    key: string,
    expiresIn: number = 28800, // 8 hours in seconds
    method: string = "GET",
    contentType?: string,
    forceSignature: boolean = false // Force AWS signature even with custom domain
  ): Promise<string> {
    // For GET requests with custom domain, we can return direct URLs (no signature needed)
    // unless forceSignature is true (needed for CORS-sensitive downloads like markdown files)
    if (this.customDomain && method === "GET" && !forceSignature) {
      return `${this.customDomain}/${key}`;
    }

    // For PUT/signed requests, always use R2 domain for proper signature generation
    // R2 automatically handles CORS for signed URLs on .r2.cloudflarestorage.com
    const baseUrl = `https://${bucketName}.r2.cloudflarestorage.com/${key}`;

    // For PUT requests, we need signatures regardless of domain
    const headers: Record<string, string> = {};
    if (contentType && method === "PUT") {
      headers["content-type"] = contentType;
    }

    try {
      // Use aws4fetch to sign the URL with query parameters
      const signedUrl = await this.client.sign(baseUrl, {
        method,
        headers,
        aws: {
          signQuery: true,
          allHeaders: false,
        },
      });

      // Add expiration to the signed URL
      const finalUrl = new URL(signedUrl.url);
      finalUrl.searchParams.set("X-Amz-Expires", expiresIn.toString());

      return finalUrl.toString();
    } catch (error) {
      console.error(
        `Failed to generate presigned URL for ${method} ${key}:`,
        error
      );
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate presigned URL: ${errorMessage}`);
    }
  }

  /**
   * Generate a direct access URL using custom domain (no signature)
   * This only works if a custom domain is configured. If no custom domain is available,
   * returns null to avoid generating broken cloudflarestorage.com URLs.
   */
  generateDirectUrl(bucketName: string, key: string): string | null {
    if (this.customDomain) {
      // Use custom domain for direct access
      return `${this.customDomain}/${key}`;
    }
    // Don't generate cloudflarestorage.com URLs as they won't work for public access
    return null;
  }
}
