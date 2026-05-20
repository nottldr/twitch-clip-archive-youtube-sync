import type Database from "better-sqlite3";

import { z } from "zod/v4";

import type { TwitchClip } from "#server/archive/types.js";
import { createLogger } from "#server/logger.js";

import { parseRow, parseRows, parseRowsLenient } from "../parse.js";

const logger = createLogger("clips-repo");

export const SyncStatusSchema = z.enum([
  "pending",
  "uploading",
  "uploaded",
  "failed",
  "skipped",
  "ignored",
]);

export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const ClipRowSchema = z.object({
  clip_id: z.string(),
  title: z.string(),
  url: z.string(),
  embed_url: z.string(),
  broadcaster_id: z.number(),
  broadcaster_name: z.string(),
  creator_id: z.number(),
  creator_name: z.string(),
  game_id: z.number().nullable(),
  language: z.string().nullable(),
  view_count: z.number(),
  created_at: z.string(),
  thumbnail_url: z.string().nullable(),
  clip_archived: z.number(),
  thumbnail_archived: z.number(),
  deleted_on_twitch: z.number(),
  sync_status: SyncStatusSchema,
  youtube_id: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  last_error: z.string().nullable(),
  retry_count: z.number(),
  first_seen_at: z.string(),
  updated_at: z.string(),
});

export type ClipRow = z.infer<typeof ClipRowSchema>;

const CountSchema = z.object({ count: z.number() });
const StatusCountSchema = z.object({ sync_status: z.string(), count: z.number() });

export interface ClipStats {
  total: number;
  pending: number;
  uploading: number;
  uploaded: number;
  failed: number;
  skipped: number;
  ignored: number;
}

export type ClipSortBy = "created_at" | "title" | "sync_status" | "retry_count";

export interface ClipFilters {
  statuses?: string[];
  search?: string;
  sortBy?: ClipSortBy;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface PaginatedClips {
  clips: ClipRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function createClipsRepository(db: Database.Database) {
  const upsertStmt = db.prepare(`
    INSERT INTO clips (
      clip_id, title, url, embed_url, broadcaster_id, broadcaster_name,
      creator_id, creator_name, game_id, language, view_count, created_at,
      thumbnail_url, clip_archived, thumbnail_archived, deleted_on_twitch
    ) VALUES (
      @clipId, @title, @url, @embedUrl, @broadcasterId, @broadcasterName,
      @creatorId, @creatorName, @gameId, @language, @viewCount, @createdAt,
      @thumbnailUrl, @clipArchived, @thumbnailArchived, @deletedOnTwitch
    )
    ON CONFLICT(clip_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      embed_url = excluded.embed_url,
      broadcaster_id = excluded.broadcaster_id,
      broadcaster_name = excluded.broadcaster_name,
      creator_id = excluded.creator_id,
      creator_name = excluded.creator_name,
      game_id = excluded.game_id,
      language = excluded.language,
      view_count = excluded.view_count,
      thumbnail_url = excluded.thumbnail_url,
      clip_archived = excluded.clip_archived,
      thumbnail_archived = excluded.thumbnail_archived,
      deleted_on_twitch = excluded.deleted_on_twitch,
      updated_at = datetime('now')
  `);

  const _upsertTransaction = db.transaction((clips: TwitchClip[]): number => {
    for (const clip of clips) {
      upsertStmt.run({
        clipId: clip.clipId,
        title: clip.title,
        url: clip.url,
        embedUrl: clip.embedUrl,
        broadcasterId: clip.broadcasterId,
        broadcasterName: clip.broadcasterName,
        creatorId: clip.creatorId,
        creatorName: clip.creatorName,
        gameId: clip.gameId,
        language: clip.language,
        viewCount: clip.viewCount,
        createdAt: clip.createdAt,
        thumbnailUrl: clip.thumbnailUrl,
        clipArchived: clip.clipArchived ? 1 : 0,
        thumbnailArchived: clip.thumbnailArchived ? 1 : 0,
        deletedOnTwitch: clip.deletedOnTwitch ? 1 : 0,
      });
    }

    const result = CountSchema.parse(
      db
        .prepare(
          "SELECT COUNT(*) as count FROM clips WHERE first_seen_at >= datetime('now', '-2 seconds')",
        )
        .get(),
    );
    return result.count;
  });

  function upsertFromArchive(clips: TwitchClip[]): number {
    return _upsertTransaction(clips);
  }

  function getById(clipId: string): ClipRow | undefined {
    return parseRow(ClipRowSchema, db.prepare("SELECT * FROM clips WHERE clip_id = ?").get(clipId));
  }

  function getNextPending(): ClipRow | undefined {
    return parseRow(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status = 'pending' ORDER BY created_at ASC LIMIT 1",
        )
        .get(),
    );
  }

  function getNextRetryable(maxRetries: number): ClipRow | undefined {
    return parseRow(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status = 'failed' AND retry_count < ? ORDER BY created_at ASC LIMIT 1",
        )
        .get(maxRetries),
    );
  }

  function markUploading(clipId: string): void {
    db.prepare(
      "UPDATE clips SET sync_status = 'uploading', updated_at = datetime('now') WHERE clip_id = ?",
    ).run(clipId);
  }

  function markUploaded(clipId: string, youtubeId: string): void {
    db.prepare(
      "UPDATE clips SET sync_status = 'uploaded', youtube_id = ?, uploaded_at = datetime('now'), updated_at = datetime('now') WHERE clip_id = ?",
    ).run(youtubeId, clipId);
  }

  function markFailed(clipId: string, error: string): void {
    db.prepare(
      "UPDATE clips SET sync_status = 'failed', last_error = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE clip_id = ?",
    ).run(error, clipId);
  }

  function markSkipped(clipId: string, reason: string): void {
    db.prepare(
      "UPDATE clips SET sync_status = 'skipped', last_error = ?, updated_at = datetime('now') WHERE clip_id = ?",
    ).run(reason, clipId);
  }

  /**
   * Recover from an interrupted upload run.
   *
   * - Rows stuck in `uploading` with no `youtube_id` → reset to `pending` (the upload never started or never returned).
   * - Rows stuck in `uploading` *with* `youtube_id` set → promote to `uploaded` (the upload succeeded but
   *   the markUploaded write didn't land before the crash). Resetting these would cause a duplicate YouTube upload.
   *
   * Both steps run in one transaction so a partial recovery can't leave the DB worse off than it started.
   * Returns `{ reset, promoted }` counts for callers to log.
   */
  const _resetInterruptedTx = db.transaction((): { reset: number; promoted: number } => {
    const promotedResult = db
      .prepare(
        `UPDATE clips
         SET sync_status = 'uploaded',
             uploaded_at = COALESCE(uploaded_at, datetime('now')),
             updated_at  = datetime('now')
         WHERE sync_status = 'uploading' AND youtube_id IS NOT NULL`,
      )
      .run();

    const resetResult = db
      .prepare(
        `UPDATE clips
         SET sync_status = 'pending', updated_at = datetime('now')
         WHERE sync_status = 'uploading' AND youtube_id IS NULL`,
      )
      .run();

    return { reset: resetResult.changes, promoted: promotedResult.changes };
  });

  function resetInterrupted(): { reset: number; promoted: number } {
    const result = _resetInterruptedTx();
    if (result.promoted > 0) {
      logger.warn(
        { promoted: result.promoted },
        "Recovered orphaned 'uploading' rows with a youtube_id by promoting to 'uploaded'",
      );
    }
    if (result.reset > 0) {
      logger.info({ reset: result.reset }, "Reset interrupted 'uploading' rows back to 'pending'");
    }
    return result;
  }

  function getStats(): ClipStats {
    const rows = parseRows(
      StatusCountSchema,
      db.prepare("SELECT sync_status, COUNT(*) as count FROM clips GROUP BY sync_status").all(),
    );

    const stats: ClipStats = {
      total: 0,
      pending: 0,
      uploading: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      ignored: 0,
    };

    for (const row of rows) {
      switch (row.sync_status) {
        case "pending":
        case "uploading":
        case "uploaded":
        case "failed":
        case "skipped":
        case "ignored":
          stats[row.sync_status] = row.count;
          break;
      }
      stats.total += row.count;
    }

    return stats;
  }

  function getClipsPaginated(filters: ClipFilters = {}): PaginatedClips {
    const {
      statuses,
      search,
      sortBy = "created_at",
      sortOrder = "asc",
      page = 1,
      pageSize = 50,
    } = filters;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (statuses && statuses.length > 0) {
      // Validate statuses against known values to prevent any unexpected input
      const validStatuses = new Set([
        "pending",
        "uploading",
        "uploaded",
        "failed",
        "skipped",
        "ignored",
      ]);
      const filtered = statuses.filter((s) => validStatuses.has(s));
      if (filtered.length > 0) {
        // Safe: placeholders are generated from array length, values are bound as parameters
        const placeholders = filtered.map(() => "?").join(", ");
        conditions.push(`sync_status IN (${placeholders})`);
        params.push(...filtered);
      }
    }

    if (search) {
      conditions.push("(title LIKE ? OR clip_id LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const allowedSorts: readonly string[] = ["created_at", "title", "sync_status", "retry_count"];
    const sort = allowedSorts.includes(sortBy) ? sortBy : "created_at";
    const order = sortOrder === "desc" ? "DESC" : "ASC";

    const totalRow = CountSchema.parse(
      db.prepare(`SELECT COUNT(*) as count FROM clips ${where}`).get(...params),
    );

    const offset = (page - 1) * pageSize;
    const clips = parseRowsLenient(
      ClipRowSchema,
      db
        .prepare(`SELECT * FROM clips ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset),
      "clips.getClipsPaginated",
    );

    return {
      clips,
      total: totalRow.count,
      page,
      pageSize,
      totalPages: Math.ceil(totalRow.count / pageSize),
    };
  }

  function getFailedForRetry(maxRetries: number): ClipRow[] {
    return parseRowsLenient(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status = 'failed' AND retry_count < ? ORDER BY created_at ASC",
        )
        .all(maxRetries),
      "clips.getFailedForRetry",
    );
  }

  function getRecentActivity(limit: number = 10): ClipRow[] {
    return parseRowsLenient(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status IN ('uploaded', 'failed', 'skipped') ORDER BY updated_at DESC LIMIT ?",
        )
        .all(limit),
      "clips.getRecentActivity",
    );
  }

  function resetClip(clipId: string): boolean {
    const result = db
      .prepare(
        "UPDATE clips SET sync_status = 'pending', youtube_id = NULL, uploaded_at = NULL, last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE clip_id = ? AND sync_status != 'pending'",
      )
      .run(clipId);
    return result.changes > 0;
  }

  function resetFailed(): number {
    const result = db
      .prepare(
        "UPDATE clips SET sync_status = 'pending', last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE sync_status IN ('failed', 'skipped')",
      )
      .run();
    return result.changes;
  }

  function resetAll(): number {
    const result = db
      .prepare(
        "UPDATE clips SET sync_status = 'pending', youtube_id = NULL, uploaded_at = NULL, last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE sync_status NOT IN ('pending', 'ignored')",
      )
      .run();
    return result.changes;
  }

  function markIgnored(clipIds: string[]): number {
    if (clipIds.length === 0) return 0;
    const stmt = db.prepare(
      "UPDATE clips SET sync_status = 'ignored', updated_at = datetime('now') WHERE clip_id = ? AND sync_status != 'ignored'",
    );
    let count = 0;
    for (const id of clipIds) {
      count += stmt.run(id).changes;
    }
    return count;
  }

  /**
   * Apply one action atomically across a list of clip IDs. Either every row's
   * mutation lands or none does. The UI relies on this for bulk operations
   * (e.g. select 50 failed clips → Retry) without leaving the table in a
   * half-changed state if some IDs are stale.
   */
  type BulkAction = "ignore" | "reset" | "retry";

  const _bulkActionTx = db.transaction((action: BulkAction, clipIds: string[]): number => {
    if (action === "ignore") {
      const stmt = db.prepare(
        "UPDATE clips SET sync_status = 'ignored', updated_at = datetime('now') WHERE clip_id = ? AND sync_status != 'ignored'",
      );
      let affected = 0;
      for (const id of clipIds) affected += stmt.run(id).changes;
      return affected;
    }
    if (action === "reset" || action === "retry") {
      // reset and retry are the same atomic operation today: clear sync state
      // and counters, leave 'ignored' rows alone. The caller (the engine
      // wrapper) is responsible for nudging the machine on retry.
      const stmt = db.prepare(
        "UPDATE clips SET sync_status = 'pending', youtube_id = NULL, uploaded_at = NULL, last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE clip_id = ? AND sync_status != 'ignored'",
      );
      let affected = 0;
      for (const id of clipIds) affected += stmt.run(id).changes;
      return affected;
    }
    throw new Error(`Unknown bulk action: ${String(action)}`);
  });

  function bulkAction(input: { action: BulkAction; clipIds: string[] }): { affected: number } {
    if (input.clipIds.length === 0) return { affected: 0 };
    return { affected: _bulkActionTx(input.action, input.clipIds) };
  }

  return {
    upsertFromArchive,
    getById,
    getNextPending,
    getNextRetryable,
    markUploading,
    markUploaded,
    markFailed,
    markSkipped,
    markIgnored,
    resetInterrupted,
    resetClip,
    resetFailed,
    resetAll,
    bulkAction,
    getStats,
    getClipsPaginated,
    getFailedForRetry,
    getRecentActivity,
  };
}

export type ClipsRepository = ReturnType<typeof createClipsRepository>;
