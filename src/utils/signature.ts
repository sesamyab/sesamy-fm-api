/**
 * Utility functions for creating and verifying URL signatures
 */

export interface SignedUrlParams {
  path: string;
  method: string;
  expire: number;
}

/**
 * Create a signature for a URL with method, path, and expiration
 */
export async function createSignature(
  secret: string,
  method: string,
  path: string,
  expire: number
): Promise<string> {
  const message = `${method}:${path}:${expire}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const base64Signature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  // Make it URL-safe
  return base64Signature
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Verify a signature for a URL
 */
export async function verifySignature(
  secret: string,
  method: string,
  path: string,
  expire: number,
  signature: string
): Promise<boolean> {
  try {
    // Check if URL has expired
    if (Date.now() > expire * 1000) {
      return false;
    }

    const expectedSignature = await createSignature(
      secret,
      method,
      path,
      expire
    );
    return expectedSignature === signature;
  } catch {
    return false;
  }
}

/**
 * Generate a signed URL with query parameters
 */
export async function generateSignedUrl(
  baseUrl: string,
  secret: string,
  method: string,
  path: string,
  expiresIn: number = 3600
): Promise<string> {
  const expire = Math.floor(Date.now() / 1000) + expiresIn;
  const signature = await createSignature(secret, method, path, expire);

  const url = new URL(baseUrl);
  url.searchParams.set("path", path);
  url.searchParams.set("expire", expire.toString());
  url.searchParams.set("signature", signature);

  return url.toString();
}
