import { Hono } from "hono";
import { StorageService } from "../utils/storage";

const storage = new Hono<{
  Bindings: {
    BUCKET: R2Bucket;
    STORAGE_SIGNATURE_SECRET: string;
  };
}>();

// Handle file operations with signature verification
storage.all("/file", async (ctx) => {
  const method = ctx.req.method;
  const path = ctx.req.query("path");
  const expire = ctx.req.query("expire");
  const signature = ctx.req.query("signature");
  const contentType = ctx.req.query("contentType");

  // Validate required parameters
  if (!path || !expire || !signature) {
    return ctx.json(
      { error: "Missing required parameters: path, expire, signature" },
      400
    );
  }

  // Create storage service
  const storageService = new StorageService(ctx.env);

  // Verify signature
  const isValid = await storageService.verifySignature(
    method,
    path,
    expire,
    signature
  );
  if (!isValid) {
    return ctx.json({ error: "Invalid or expired signature" }, 403);
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
      // Set cache control - default to 1 year for immutable content, or use provided value
      if (file.httpMetadata?.cacheControl) {
        headers["Cache-Control"] = file.httpMetadata.cacheControl;
      } else {
        // Audio and image files are typically immutable (new upload = new file)
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }

      // Add ETag for caching
      if (file.etag) {
        headers["ETag"] = file.etag;
      }

      // Check If-None-Match for conditional requests
      const ifNoneMatch = ctx.req.header("If-None-Match");
      if (ifNoneMatch && file.etag && ifNoneMatch === file.etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: file.etag,
          },
        });
      }

      return new Response(file.data, {
        status: 200,
        headers,
      });
    } else if (method === "PUT") {
      // Upload file
      const body = await ctx.req.arrayBuffer();

      const result = await storageService.uploadFile(path, body, {
        contentType: contentType || "application/octet-stream",
      });

      return ctx.json({
        success: true,
        key: result.key,
        size: result.size,
        etag: result.etag,
        uploaded: result.uploaded,
      });
    } else {
      return ctx.json({ error: `Method ${method} not supported` }, 405);
    }
  } catch (error) {
    console.error("Storage operation failed:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return ctx.json({ error: "File not found" }, 404);
    }

    return ctx.json(
      {
        error: "Storage operation failed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default storage;
