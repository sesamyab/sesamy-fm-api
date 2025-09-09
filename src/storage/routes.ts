import { Hono } from "hono";
import { StorageService } from "../utils/storage";

const storage = new Hono<{
  Bindings: {
    BUCKET: R2Bucket;
    STORAGE_SIGNATURE_SECRET: string;
  };
}>();

// Handle file operations with signature verification
storage.all("/file", async (c) => {
  const method = c.req.method;
  const path = c.req.query("path");
  const expire = c.req.query("expire");
  const signature = c.req.query("signature");
  const contentType = c.req.query("contentType");

  // Validate required parameters
  if (!path || !expire || !signature) {
    return c.json(
      { error: "Missing required parameters: path, expire, signature" },
      400
    );
  }

  // Create storage service
  const storageService = new StorageService(c.env);

  // Verify signature
  const isValid = await storageService.verifySignature(
    method,
    path,
    expire,
    signature
  );
  if (!isValid) {
    return c.json({ error: "Invalid or expired signature" }, 403);
  }

  try {
    if (method === "GET") {
      // Download file
      const file = await storageService.downloadFile(path);

      // Set appropriate headers
      const headers: Record<string, string> = {};
      if (file.httpMetadata?.contentType) {
        headers["Content-Type"] = file.httpMetadata.contentType;
      }
      if (file.httpMetadata?.cacheControl) {
        headers["Cache-Control"] = file.httpMetadata.cacheControl;
      }

      return new Response(file.data, {
        status: 200,
        headers,
      });
    } else if (method === "PUT") {
      // Upload file
      const body = await c.req.arrayBuffer();

      const result = await storageService.uploadFile(path, body, {
        contentType: contentType || "application/octet-stream",
      });

      return c.json({
        success: true,
        key: result.key,
        size: result.size,
        etag: result.etag,
        uploaded: result.uploaded,
      });
    } else {
      return c.json({ error: `Method ${method} not supported` }, 405);
    }
  } catch (error) {
    console.error("Storage operation failed:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json(
      {
        error: "Storage operation failed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Health check endpoint
storage.get("/health", async (c) => {
  return c.json({ status: "ok", service: "storage" });
});

export default storage;
