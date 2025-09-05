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
});

// Path parameters
export const AudioParamsSchema = z.object({
  show_id: z.string().uuid(),
  episode_id: z.string().uuid(),
});

// Types
export type AudioUpload = z.infer<typeof AudioUploadSchema>;
export type AudioParams = z.infer<typeof AudioParamsSchema>;
