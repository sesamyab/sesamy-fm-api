import { R2PreSignedUrlGenerator } from "./r2-presigned-url.js";

/**
 * Helper functions for consistent R2 presigned URL generation across the codebase
 */

/**
 * Generate a presigned URL for downloading from R2
 * @param generator - The R2PreSignedUrlGenerator instance
 * @param bucketName - The R2 bucket name (e.g., "podcast-service-assets")
 * @param key - The object key in R2
 * @param expiresIn - Expiration time in seconds (default: 8 hours)
 * @param withCors - Whether to force AWS signature for CORS support (default: false)
 * @returns Presigned URL string
 */
export async function generateDownloadUrl(
  generator: R2PreSignedUrlGenerator,
  bucketName: string,
  key: string,
  expiresIn: number = 28800, // 8 hours default
  withCors: boolean = false
): Promise<string> {
  return await generator.generatePresignedUrl(
    bucketName,
    key,
    expiresIn,
    "GET",
    undefined,
    withCors // forceSignature for CORS support
  );
}

/**
 * Generate a presigned URL for downloading from R2 with CORS support
 * This is useful for browser-based downloads and markdown/script files
 * @param generator - The R2PreSignedUrlGenerator instance
 * @param bucketName - The R2 bucket name (e.g., "podcast-service-assets")
 * @param key - The object key in R2
 * @param expiresIn - Expiration time in seconds (default: 8 hours)
 * @returns Presigned URL string with CORS support
 */
export async function generateCorsDownloadUrl(
  generator: R2PreSignedUrlGenerator,
  bucketName: string,
  key: string,
  expiresIn: number = 28800 // 8 hours default
): Promise<string> {
  return await generateDownloadUrl(generator, bucketName, key, expiresIn, true);
}

/**
 * Strip the r2:// prefix from a URL and return the key
 * @param url - URL that may have r2:// prefix
 * @returns The R2 key without prefix
 */
export function stripR2Prefix(url: string): string {
  return url.replace(/^r2:\/\//, "");
}

/**
 * Check if a URL is an R2 URL (has r2:// prefix)
 * @param url - URL to check
 * @returns true if URL starts with r2://
 */
export function isR2Url(url: string): boolean {
  return url.startsWith("r2://");
}
