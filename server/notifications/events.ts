export enum SyncEvent {
  UPLOAD_SUCCESS = "upload:success",
  UPLOAD_FAILURE = "upload:failure",
  QUOTA_EXHAUSTED = "quota:exhausted",
  QUOTA_RESET = "quota:reset",
  DAILY_SUMMARY = "daily:summary",
  SYNC_ERROR = "sync:error",
  AUTH_EXPIRED = "auth:expired",
}
