import { z } from "zod";

// Campaign status enum
export const CampaignStatus = z.enum(["draft", "active", "paused", "ended"]);

// Creative placement type enum
export const PlacementType = z.enum(["pre", "mid", "post", "any"]);

// Creative type enum
export const CreativeType = z.enum(["audio", "video", "display"]);

// Base campaign schema
export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  advertiser: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  targetImpressions: z.number().nullable(),
  priority: z.number(),
  status: CampaignStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Create campaign schema (without auto-generated fields)
export const CreateCampaignSchema = z
  .object({
    name: z.string().min(1, "Campaign name is required"),
    advertiser: z.string().optional(),
    startDate: z
      .string()
      .refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid start date format",
      })
      .optional(),
    endDate: z
      .string()
      .refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid end date format",
      })
      .optional(),
    targetImpressions: z.number().positive().optional(),
    priority: z.number().min(1).max(10).default(5),
    status: CampaignStatus.default("draft"),
    showIds: z
      .array(z.string())
      .min(1, "At least one show must be selected")
      .optional(),
  })
  .refine(
    (data) => {
      // If status is active, require startDate, endDate, and showIds
      if (data.status === "active") {
        return data.startDate && data.endDate && data.showIds;
      }
      return true;
    },
    {
      message:
        "startDate, endDate, and showIds are required when status is active",
    }
  )
  .refine(
    (data) => {
      // Only validate date order if both dates are provided
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) < new Date(data.endDate);
      }
      return true;
    },
    {
      message: "End date must be after start date",
      path: ["endDate"],
    }
  );

// Update campaign schema (base without refinement)
const UpdateCampaignBaseSchema = z.object({
  name: z.string().min(1, "Campaign name is required").optional(),
  advertiser: z.string().optional(),
  startDate: z
    .string()
    .refine((date) => !isNaN(Date.parse(date)), {
      message: "Invalid start date format",
    })
    .optional(),
  endDate: z
    .string()
    .refine((date) => !isNaN(Date.parse(date)), {
      message: "Invalid end date format",
    })
    .optional(),
  targetImpressions: z.number().positive().optional(),
  priority: z.number().min(1).max(10).optional(),
  status: CampaignStatus.optional(),
  showIds: z.array(z.string()).optional(),
});

export const UpdateCampaignSchema = UpdateCampaignBaseSchema.refine(
  (data) => {
    // If status is being set to active, require startDate, endDate, and showIds
    if (data.status === "active") {
      return data.startDate && data.endDate && data.showIds;
    }
    return true;
  },
  {
    message:
      "startDate, endDate, and showIds are required when status is active",
  }
).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) < new Date(data.endDate);
    }
    return true;
  },
  {
    message: "End date must be after start date",
    path: ["endDate"],
  }
);

// Base creative schema
export const CreativeSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  type: CreativeType,
  fileUrl: z.string().nullable(),
  duration: z.number().nullable(),
  placementType: PlacementType,
  language: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Create creative schema
export const CreateCreativeSchema = z.object({
  campaignId: z.string(),
  name: z.string().min(1, "Creative name is required"),
  type: CreativeType.default("audio"),
  fileUrl: z.string().url("Invalid file URL").optional(),
  duration: z.number().positive("Duration must be positive").optional(),
  placementType: PlacementType.default("any"),
  language: z.string().length(2).optional(), // ISO 639-1 language code
});

// Update creative schema
export const UpdateCreativeSchema = CreateCreativeSchema.partial().omit({
  campaignId: true,
});

// Campaign with creatives and shows
export const CampaignWithDetailsSchema = CampaignSchema.extend({
  creatives: z.array(CreativeSchema),
  shows: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
    })
  ),
});

// Pagination schema
export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// URL parameters
export const CampaignParamsSchema = z.object({
  campaign_id: z.string(),
});

export const CreativeParamsSchema = z.object({
  campaign_id: z.string(),
  creative_id: z.string(),
});

// Audio upload for creatives
export const AudioUploadSchema = z.object({
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  url: z.string(),
});

// Types
export type Campaign = z.infer<typeof CampaignSchema>;
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;
export type UpdateCampaign = z.infer<typeof UpdateCampaignSchema>;

export type Creative = z.infer<typeof CreativeSchema>;
export type CreateCreative = z.infer<typeof CreateCreativeSchema>;
export type UpdateCreative = z.infer<typeof UpdateCreativeSchema>;

export type CampaignWithDetails = z.infer<typeof CampaignWithDetailsSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type CampaignParams = z.infer<typeof CampaignParamsSchema>;
export type CreativeParams = z.infer<typeof CreativeParamsSchema>;
export type AudioUpload = z.infer<typeof AudioUploadSchema>;
