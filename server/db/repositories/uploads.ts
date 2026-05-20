import type { EngineLogRepository } from "./engine-log.js";
import type Database from "better-sqlite3";

import { z } from "zod/v4";

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

export interface RecordSuccessInput {
  clipId: string;
  attemptId: number;
  youtubeId: string;
  quotaCost: number;
  /** PT date string (YYYY-MM-DD) for the quota_usage row. */
  datePt: string;
}

export interface RecordFailureInput {
  clipId: string;
  attemptId: number;
  errorMessage: string;
  errorCode: string;
}

export interface RecordSystemFailureInput {
  attemptId: number;
  /** Clip whose attempt this was — populated in the engine_log row for searchability. */
  clipId: string;
  errorMessage: string;
  errorCode: string;
}

/**
 * Uploads repository. Pass in an EngineLogRepository so that every finalize
 * call (recordSuccess/Failure/SystemFailure) also writes a `type='upload'` audit
 * row to engine_log inside the same db.transaction — meaning either both the
 * domain write AND the audit log land, or neither does. This is the single
 * source of truth that the UI's /api/logs?clipId=… surface depends on.
 */
export function createUploadsRepository(db: Database.Database, engineLog: EngineLogRepository) {
  function logAttempt(clipId: string, quotaCost: number): number {
    const result = db
      .prepare("INSERT INTO upload_attempts (clip_id, quota_cost) VALUES (?, ?)")
      .run(clipId, quotaCost);
    return Number(result.lastInsertRowid);
  }

  /**
   * Finalize a successful upload atomically: complete the attempt row, mark the
   * clip as uploaded, and increment today's quota usage. Either all three writes
   * land or none do.
   *
   * Preferred over calling completeAttempt + markUploaded + recordUpload
   * separately, which previously could leave the DB inconsistent on a mid-flight
   * crash (e.g. clip marked uploaded but quota never incremented).
   */
  const _recordSuccessTx = db.transaction((input: RecordSuccessInput): void => {
    db.prepare(
      `UPDATE upload_attempts SET
        completed_at = datetime('now'),
        success = 1,
        youtube_id = ?,
        error_message = NULL,
        error_code = NULL
       WHERE id = ?`,
    ).run(input.youtubeId, input.attemptId);

    db.prepare(
      `UPDATE clips SET sync_status = 'uploaded',
        youtube_id = ?,
        uploaded_at = datetime('now'),
        updated_at = datetime('now')
       WHERE clip_id = ?`,
    ).run(input.youtubeId, input.clipId);

    db.prepare(
      `INSERT INTO quota_usage (date_pt, units_used, uploads_count)
       VALUES (?, ?, 1)
       ON CONFLICT(date_pt) DO UPDATE SET
         units_used = units_used + ?,
         uploads_count = uploads_count + 1,
         updated_at = datetime('now')`,
    ).run(input.datePt, input.quotaCost, input.quotaCost);

    engineLog.insert({
      type: "upload",
      clipId: input.clipId,
      youtubeId: input.youtubeId,
      message: `Uploaded clip ${input.clipId} to YouTube as ${input.youtubeId}`,
    });
  });

  function recordSuccess(input: RecordSuccessInput): void {
    _recordSuccessTx(input);
  }

  /**
   * Finalize a failed upload atomically: complete the attempt row with error
   * details, and mark the clip as failed (incrementing retry_count). No quota
   * is recorded — failed uploads still cost quota at the API level, but tracking
   * that here would require a separate code path; today we only count successful
   * uploads (matches the prior behaviour, see scheduler.canUpload).
   */
  const _recordFailureTx = db.transaction((input: RecordFailureInput): void => {
    db.prepare(
      `UPDATE upload_attempts SET
        completed_at = datetime('now'),
        success = 0,
        youtube_id = NULL,
        error_message = ?,
        error_code = ?
       WHERE id = ?`,
    ).run(input.errorMessage, input.errorCode, input.attemptId);

    db.prepare(
      `UPDATE clips SET sync_status = 'failed',
        last_error = ?,
        retry_count = retry_count + 1,
        updated_at = datetime('now')
       WHERE clip_id = ?`,
    ).run(`${input.errorCode}: ${input.errorMessage}`, input.clipId);

    engineLog.insert({
      type: "upload",
      clipId: input.clipId,
      error: `${input.errorCode}: ${input.errorMessage}`,
      message: `Upload failed for clip ${input.clipId}: ${input.errorCode}`,
    });
  });

  function recordFailure(input: RecordFailureInput): void {
    _recordFailureTx(input);
  }

  /**
   * Mark only the attempt row as failed — does NOT touch the clip's sync_status
   * or retry_count. Use for system-state failures (quota exhausted, upload limit
   * hit, auth lost) where the clip itself is fine; the orchestrator will reset
   * the clip back to 'pending' and re-attempt later. Also writes an engine_log
   * row tagged with the clip_id so the UI can surface "tried clip X, system gate".
   */
  const _recordSystemFailureTx = db.transaction((input: RecordSystemFailureInput): void => {
    db.prepare(
      `UPDATE upload_attempts SET
        completed_at = datetime('now'),
        success = 0,
        youtube_id = NULL,
        error_message = ?,
        error_code = ?
       WHERE id = ?`,
    ).run(input.errorMessage, input.errorCode, input.attemptId);

    engineLog.insert({
      type: "upload",
      clipId: input.clipId,
      error: `${input.errorCode}: ${input.errorMessage}`,
      message: `System-level upload failure for clip ${input.clipId}: ${input.errorCode}`,
    });
  });

  function recordSystemFailure(input: RecordSystemFailureInput): void {
    _recordSystemFailureTx(input);
  }

  function getRecentAttempts(limit: number = 10) {
    return db
      .prepare(
        "SELECT ua.*, c.title FROM upload_attempts ua JOIN clips c ON ua.clip_id = c.clip_id ORDER BY ua.started_at DESC LIMIT ?",
      )
      .all(limit);
  }

  /**
   * Per-clip attempt history. ID-cursor pagination (descending) — newest
   * attempt first. The drawer in the UI uses this; the v5 index
   * `idx_upload_attempts_clip_started` keeps it O(log n).
   */
  function getAttemptsByClip(
    clipId: string,
    opts: { limit?: number; beforeId?: number } = {},
  ): { attempts: UploadAttemptRow[]; hasMore: boolean } {
    const limit = Math.min(opts.limit ?? 50, 200);
    const params: unknown[] = [clipId];
    let sql =
      "SELECT id, clip_id, started_at, completed_at, success, youtube_id, error_message, error_code, quota_cost FROM upload_attempts WHERE clip_id = ?";

    if (opts.beforeId !== undefined) {
      sql += " AND id < ?";
      params.push(opts.beforeId);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    // Fetch one extra to determine hasMore without a second query.
    params.push(limit + 1);

    const rows = db
      .prepare(sql)
      .all(...params)
      .map((r) => UploadAttemptRowSchema.parse(r));
    const hasMore = rows.length > limit;
    return { attempts: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  return {
    logAttempt,
    recordSuccess,
    recordFailure,
    recordSystemFailure,
    getRecentAttempts,
    getAttemptsByClip,
  };
}

export type UploadsRepository = ReturnType<typeof createUploadsRepository>;
