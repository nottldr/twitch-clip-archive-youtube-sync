import {
  EngineSnapshotSchema,
  EngineStatePathSchema,
  LogEntrySchema,
  LogEntryTypeSchema,
  PaginatedLogsSchema,
  UploadProgressSchema,
  WaitReasonSchema,
} from "#shared/schemas.js";
import { z } from "zod/v4";

// Re-export shared schemas
export {
  EngineSnapshotSchema,
  EngineStatePathSchema,
  LogEntrySchema,
  LogEntryTypeSchema,
  PaginatedLogsSchema,
  UploadProgressSchema,
  WaitReasonSchema,
};

// Re-export shared types
export type {
  EngineSnapshot,
  EngineStatePath,
  LogEntry,
  UploadProgress,
  WaitReason,
} from "#shared/schemas.js";

// Clip stats
export const ClipStatsSchema = z.object({
  total: z.number(),
  pending: z.number(),
  uploading: z.number(),
  uploaded: z.number(),
  failed: z.number(),
  skipped: z.number(),
  ignored: z.number(),
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
  engine: EngineSnapshotSchema,
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
  embed_url: z.string().optional(),
  broadcaster_id: z.number().optional(),
  creator_id: z.number().optional(),
  game_id: z.number().nullable().optional(),
  language: z.string().nullable().optional(),
  clip_archived: z.number().optional(),
  thumbnail_archived: z.number().optional(),
  deleted_on_twitch: z.number().optional(),
  first_seen_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const UploadAttemptRowSchema = z.object({
  id: z.number(),
  clip_id: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  success: z.number(),
  youtube_id: z.string().nullable(),
  error_message: z.string().nullable(),
  error_code: z.string().nullable(),
  quota_cost: z.number(),
});

export type UploadAttemptRow = z.infer<typeof UploadAttemptRowSchema>;

export const ClipDetailSchema = z.object({
  clip: ClipRowSchema,
  attempts: z.array(UploadAttemptRowSchema),
  attemptsHasMore: z.boolean(),
  logs: z.array(LogEntrySchema),
  logsHasMore: z.boolean(),
});

export type ClipDetail = z.infer<typeof ClipDetailSchema>;

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

export const QuotaHistorySchema = z.array(QuotaHistoryEntrySchema);

// Inferred types
export type ClipStats = z.infer<typeof ClipStatsSchema>;
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;
export type QuotaHistoryEntry = z.infer<typeof QuotaHistoryEntrySchema>;
export type EstimatedCompletion = z.infer<typeof EstimatedCompletionSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type ClipRow = z.infer<typeof ClipRowSchema>;
export type PaginatedClips = z.infer<typeof PaginatedClipsSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

// SSE event types — names match what server/index.ts broadcasts.
// Per-event payload schemas; the EngineSnapshot full-state broadcast travels
// as the data of "engine:state" and is parsed via EngineSnapshotSchema directly.

const ClipUploadedEventSchema = z.object({
  type: z.literal("clip:uploaded"),
  clipId: z.string(),
  youtubeId: z.string(),
});

const ClipFailedEventSchema = z.object({
  type: z.literal("clip:failed"),
  clipId: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
});

const ClipSkippedEventSchema = z.object({
  type: z.literal("clip:skipped"),
  clipId: z.string(),
  reason: z.string(),
});

const EngineStateEventSchema = z.object({
  type: z.literal("engine:state"),
  // The full snapshot is broadcast as the event data
});

const UploadProgressEventSchema = z.object({
  type: z.literal("engine:upload-progress"),
  clipId: z.string(),
  bytesTransferred: z.number(),
  totalBytes: z.number(),
});

const AuthLostEventSchema = z.object({
  type: z.literal("auth:lost"),
  state: z.string(),
});

const AuthGainedEventSchema = z.object({
  type: z.literal("auth:gained"),
  state: z.string(),
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  ClipUploadedEventSchema,
  ClipFailedEventSchema,
  ClipSkippedEventSchema,
  EngineStateEventSchema,
  UploadProgressEventSchema,
  AuthLostEventSchema,
  AuthGainedEventSchema,
]);

export type SSEEvent = z.infer<typeof SSEEventSchema>;

/**
 * Event types whose arrival should cause a TanStack Query refetch. The new
 * sse-context maps these to specific keys; see Phase 2.7. Kept here so the
 * fetch hook and the context share one source of truth.
 */
export const REFETCH_EVENT_TYPES = new Set<string>([
  "clip:uploaded",
  "clip:failed",
  "clip:skipped",
  "engine:state",
  "auth:lost",
  "auth:gained",
]);
