export interface StorageEnv {
  BUCKET: R2Bucket;
  // Add a secret key for signing URLs
  STORAGE_SIGNATURE_SECRET: string;
}

export interface StorageOptions {
  contentType?: string;
}

export interface SignedUrlOptions {
  path: string;
  method: "GET" | "PUT";
  expiresIn?: number; // in seconds
  contentType?: string;
}

export class StorageService {
  constructor(private env: StorageEnv) {}

  /**
   * Generate a signed URL for internal use
   */
  async generateSignedUrl(options: SignedUrlOptions, baseUrl?: string) {
    const { path, method, expiresIn = 3600, contentType } = options;

    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const signature = await this.createSignature(method, path, expires);

    const params = new URLSearchParams({
      path,
      expire: expires.toString(),
      signature,
    });

    if (contentType && method === "PUT") {
      params.set("contentType", contentType);
    }

    const relativePath = `/storage/file?${params.toString()}`;
    const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

    return {
      url: fullUrl,
      expires: new Date(expires * 1000),
      signature,
    };
  }

  /**
   * Verify a signed URL request
   */
  async verifySignature(
    method: string,
    path: string,
    expire: string,
    signature: string
  ): Promise<boolean> {
    const expireTime = parseInt(expire);
    const currentTime = Math.floor(Date.now() / 1000);

    // Check if expired
    if (currentTime > expireTime) {
      return false;
    }

    // Verify signature
    const expectedSignature = await this.createSignature(
      method,
      path,
      expireTime
    );
    return expectedSignature === signature;
  }

  /**
   * Create HMAC signature for method + path + expire
   */
  private async createSignature(
    method: string,
    path: string,
    expire: number
  ): Promise<string> {
    const message = `${method}:${path}:${expire}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.env.STORAGE_SIGNATURE_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(message)
    );

    // Convert to base64url
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Upload a file to the specified path
   */
  async uploadFile(
    path: string,
    data: ArrayBuffer | ReadableStream | string,
    options?: StorageOptions
  ) {
    const objectKey = path.startsWith("/") ? path.substring(1) : path;

    const uploadOptions: R2PutOptions = {};
    if (options?.contentType) {
      uploadOptions.httpMetadata = {
        contentType: options.contentType,
      };
    }

    const result = await this.env.BUCKET.put(objectKey, data, uploadOptions);
    return {
      key: result.key,
      etag: result.etag,
      size: result.size,
      uploaded: result.uploaded,
    };
  }

  /**
   * Download a file from the specified path
   */
  async downloadFile(path: string) {
    const objectKey = path.startsWith("/") ? path.substring(1) : path;

    const object = await this.env.BUCKET.get(objectKey);
    if (!object) {
      throw new Error(`Object not found: ${objectKey}`);
    }

    return {
      data: object.body,
      size: object.size,
      etag: object.etag,
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
    };
  }

  /**
   * Delete a file at the specified path
   */
  async deleteFile(path: string) {
    const objectKey = path.startsWith("/") ? path.substring(1) : path;
    await this.env.BUCKET.delete(objectKey);
    return { deleted: objectKey };
  }

  /**
   * Check if a file exists at the specified path
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const objectKey = path.startsWith("/") ? path.substring(1) : path;
      const object = await this.env.BUCKET.head(objectKey);
      return object !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get file metadata
   */
  async getFileInfo(path: string) {
    const objectKey = path.startsWith("/") ? path.substring(1) : path;
    return await this.env.BUCKET.head(objectKey);
  }

  /**
   * List objects with optional prefix
   */
  async listObjects(prefix?: string, limit?: number) {
    const options: R2ListOptions = {};
    if (prefix) options.prefix = prefix;
    if (limit) options.limit = limit;

    const result = await this.env.BUCKET.list(options);
    return {
      objects: result.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.etag,
      })),
      truncated: result.truncated,
    };
  }
}

// Utility functions for common operations
export function createStorageService(env: StorageEnv) {
  return new StorageService(env);
}

/**
 * Generate a signed upload URL
 */
export async function generateSignedUploadUrl(
  env: StorageEnv & { SERVICE_BASE_URL?: string },
  path: string,
  contentType?: string,
  expiresIn?: number
) {
  const storage = new StorageService(env);
  return storage.generateSignedUrl(
    {
      path,
      method: "PUT",
      contentType,
      expiresIn,
    },
    env.SERVICE_BASE_URL
  );
}

/**
 * Generate a signed download URL
 */
export async function generateSignedDownloadUrl(
  env: StorageEnv & { SERVICE_BASE_URL?: string },
  path: string,
  expiresIn?: number
) {
  const storage = new StorageService(env);
  return storage.generateSignedUrl(
    {
      path,
      method: "GET",
      expiresIn,
    },
    env.SERVICE_BASE_URL
  );
}
