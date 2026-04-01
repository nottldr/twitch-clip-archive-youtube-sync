import type Database from "better-sqlite3";

export function createUploadsRepository(db: Database.Database) {
  function logAttempt(clipId: string, quotaCost: number): number {
    const result = db
      .prepare("INSERT INTO upload_attempts (clip_id, quota_cost) VALUES (?, ?)")
      .run(clipId, quotaCost);
    return Number(result.lastInsertRowid);
  }

  function completeAttempt(
    attemptId: number,
    success: boolean,
    youtubeId?: string,
    errorMessage?: string,
    errorCode?: string,
  ): void {
    db.prepare(
      `UPDATE upload_attempts SET
        completed_at = datetime('now'),
        success = ?,
        youtube_id = ?,
        error_message = ?,
        error_code = ?
       WHERE id = ?`,
    ).run(success ? 1 : 0, youtubeId ?? null, errorMessage ?? null, errorCode ?? null, attemptId);
  }

  function getRecentAttempts(limit: number = 10) {
    return db
      .prepare(
        "SELECT ua.*, c.title FROM upload_attempts ua JOIN clips c ON ua.clip_id = c.clip_id ORDER BY ua.started_at DESC LIMIT ?",
      )
      .all(limit);
  }

  return {
    logAttempt,
    completeAttempt,
    getRecentAttempts,
  };
}

export type UploadsRepository = ReturnType<typeof createUploadsRepository>;
