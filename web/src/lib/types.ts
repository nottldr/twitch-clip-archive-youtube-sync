import { SyncModeSchema } from "#shared/schemas.js";
import { z } from "zod/v4";

export const ClipStatsSchema = z.object({
  total: z.number(),
  pending: z.number(),
  uploading: z.number(),
  uploaded: z.number(),
  failed: z.number(),
  skipped: z.number(),
});

export const QuotaUsageSchema = z.object({
  used: z.number(),
  limit: z.number(),
  limitSource: z.enum(["google-api", "config"]),
  remaining: z.number(),
  uploadsToday: z.number(),
  resetsAt: z.string(),
});

export const QuotaHistoryEntrySchema = z.object({
  date: z.string(),
  unitsUsed: z.number(),
  uploadsCount: z.number(),
});

export const EstimatedCompletionSchema = z.object({
  daysRemaining: z.number(),
  estimatedDate: z.string().nullable(),
});

export const DashboardStatsSchema = z.object({
  clips: ClipStatsSchema,
  quota: QuotaUsageSchema,
  engine: z.object({
    status: z.string(),
    syncMode: SyncModeSchema,
    paused: z.boolean(),
    currentUpload: z.string().nullable(),
  }),
  estimated: EstimatedCompletionSchema,
});

export const ClipRowSchema = z.object({
  clip_id: z.string(),
  title: z.string(),
  url: z.string(),
  broadcaster_name: z.string(),
  creator_name: z.string(),
  created_at: z.string(),
  sync_status: z.string(),
  youtube_id: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  last_error: z.string().nullable(),
  retry_count: z.number(),
  view_count: z.number(),
  thumbnail_url: z.string().nullable(),
});

export const PaginatedClipsSchema = z.object({
  clips: z.array(ClipRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export const OAuthStatusSchema = z.object({
  connected: z.boolean(),
});

export const ActivityItemSchema = z.object({
  clip_id: z.string(),
  title: z.string(),
  sync_status: z.string(),
  youtube_id: z.string().nullable(),
  last_error: z.string().nullable(),
  updated_at: z.string(),
});

export const RecentActivitySchema = z.array(ActivityItemSchema);

export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const QuotaHistorySchema = z.array(QuotaHistoryEntrySchema);

// Inferred types for use in components
export type ClipStats = z.infer<typeof ClipStatsSchema>;
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;
export type QuotaHistoryEntry = z.infer<typeof QuotaHistoryEntrySchema>;
export type EstimatedCompletion = z.infer<typeof EstimatedCompletionSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type ClipRow = z.infer<typeof ClipRowSchema>;
export type PaginatedClips = z.infer<typeof PaginatedClipsSchema>;

// SSE event discriminated unions

const UploadSuccessEventSchema = z.object({
  type: z.literal("upload:success"),
  clipId: z.string(),
  youtubeId: z.string(),
});

const UploadFailureEventSchema = z.object({
  type: z.literal("upload:failure"),
  clipId: z.string(),
  error: z.string(),
});

const QuotaExhaustedEventSchema = z.object({
  type: z.literal("quota:exhausted"),
});

const SyncStatusEventSchema = z.object({
  type: z.literal("sync:status"),
  status: z.string(),
});

const SyncErrorEventSchema = z.object({
  type: z.literal("sync:error"),
  error: z.string(),
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  UploadSuccessEventSchema,
  UploadFailureEventSchema,
  QuotaExhaustedEventSchema,
  SyncStatusEventSchema,
  SyncErrorEventSchema,
]);

export type SSEEvent = z.infer<typeof SSEEventSchema>;

/** Events that should trigger a data refetch. */
export const REFETCH_EVENT_TYPES = new Set<SSEEvent["type"]>([
  "upload:success",
  "upload:failure",
  "quota:exhausted",
  "sync:status",
]);
