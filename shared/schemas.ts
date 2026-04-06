import { z } from "zod/v4";

// Wait reasons for the WAITING state
export const WaitReasonSchema = z.enum([
  "QUOTA_EXHAUSTED",
  "UPLOAD_LIMIT",
  "COOLDOWN",
  "NO_CLIPS",
  "ERROR",
]);
export type WaitReason = z.infer<typeof WaitReasonSchema>;

// Log entry types
export const LogEntryTypeSchema = z.enum(["state_change", "upload", "error"]);
export type LogEntryType = z.infer<typeof LogEntryTypeSchema>;

// Task status shown in the UI
export const TaskStatusSchema = z.object({
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  status: z.enum(["idle", "running", "completed", "failed"]),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Upload progress during an active upload
export const UploadProgressSchema = z.object({
  clipId: z.string(),
  clipTitle: z.string(),
  bytesTransferred: z.number(),
  totalBytes: z.number(),
  startedAt: z.string(),
  elapsedMs: z.number(),
});
export type UploadProgress = z.infer<typeof UploadProgressSchema>;

// All possible XState state paths
export const EngineStatePathSchema = z.enum([
  "stopped",
  "starting.importingArchive",
  "starting.discoveringQuota",
  "starting.settling",
  "active.blocked.awaitingAuth",
  "active.blocked.userPaused",
  "active.deciding",
  "active.uploading",
  "active.reimporting",
  "active.rediscovering",
  "active.waiting.quotaExhausted",
  "active.waiting.uploadLimit",
  "active.waiting.cooldown",
  "active.waiting.noClips",
  "active.waiting.error",
]);
export type EngineStatePath = z.infer<typeof EngineStatePathSchema>;

// Engine snapshot returned by the API
export const EngineSnapshotSchema = z.object({
  state: EngineStatePathSchema,
  context: z.object({
    // Upload state
    clipId: z.string().nullable(),
    clipTitle: z.string().nullable(),
    uploadStartedAt: z.string().nullable(),
    bytesTransferred: z.number().nullable(),
    totalBytes: z.number().nullable(),
    // Wait state
    waitResumeAt: z.string().nullable(),
    lastError: z.string().nullable(),
    // Task tracking
    lastImportAt: z.string().nullable(),
    clipsImported: z.number().nullable(),
    lastQuotaDiscoveryAt: z.string().nullable(),
    quotaLimit: z.number().nullable(),
    // User control
    userPaused: z.boolean(),
  }),
  tasks: z.object({
    archiveImport: TaskStatusSchema,
    quotaDiscovery: TaskStatusSchema,
  }),
});
export type EngineSnapshot = z.infer<typeof EngineSnapshotSchema>;

// Log entry stored in SQLite and returned by API
export const LogEntrySchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  type: LogEntryTypeSchema,
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  event: z.string().nullable(),
  clipId: z.string().nullable(),
  youtubeId: z.string().nullable(),
  error: z.string().nullable(),
  message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const PaginatedLogsSchema = z.object({
  entries: z.array(LogEntrySchema),
  hasMore: z.boolean(),
});
export type PaginatedLogs = z.infer<typeof PaginatedLogsSchema>;
