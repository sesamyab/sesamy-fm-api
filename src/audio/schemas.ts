import { z } from "zod";

// Response schemas
export const AudioUploadSchema = z.object({
  id: z.string().uuid(),
  episodeId: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int().positive(),
  mimeType: z.string(),
  url: z.string().url(),
  uploadedAt: z.string().datetime(),
  message: z.string().optional(),
});

// Multipart upload schemas
export const InitiateMultipartUploadSchema = z.object({
  fileName: z.string(),
  fileSize: z.number().int().positive(),
  mimeType: z.string(),
  totalChunks: z.number().int().positive(),
});

export const MultipartUploadResponseSchema = z.object({
  uploadId: z.string(),
  fileName: z.string(),
  chunkSize: z.number().int(),
  totalChunks: z.number().int(),
});

export const CompleteMultipartUploadSchema = z.object({
  uploadId: z.string(),
});

export const ChunkUploadResponseSchema = z.object({
  uploadId: z.string(),
  chunkNumber: z.number().int(),
  received: z.number().int(),
  total: z.number().int(),
});

// Path parameters
export const AudioParamsSchema = z.object({
  show_id: z.string().uuid(),
  episode_id: z.string().uuid(),
});

export const MultipartUploadParamsSchema = z.object({
  show_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  upload_id: z.string(),
});

export const ChunkParamsSchema = z.object({
  show_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  upload_id: z.string(),
  chunk_number: z.coerce.number().int().positive(),
});

// Types
export type AudioUpload = z.infer<typeof AudioUploadSchema>;
export type AudioParams = z.infer<typeof AudioParamsSchema>;
export type InitiateMultipartUpload = z.infer<
  typeof InitiateMultipartUploadSchema
>;
export type CompleteMultipartUpload = z.infer<
  typeof CompleteMultipartUploadSchema
>;
