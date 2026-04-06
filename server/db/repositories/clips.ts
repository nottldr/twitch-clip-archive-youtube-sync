import type Database from "better-sqlite3";

import { z } from "zod/v4";

import type { TwitchClip } from "#server/archive/types.js";

import { parseRow, parseRows } from "../parse.js";

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
  sync_status: z.string(),
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

export interface ClipFilters {
  statuses?: string[];
  search?: string;
  sortBy?: "created_at" | "title" | "sync_status";
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

  function resetInterrupted(): number {
    const result = db
      .prepare(
        "UPDATE clips SET sync_status = 'pending', updated_at = datetime('now') WHERE sync_status = 'uploading'",
      )
      .run();
    return result.changes;
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

    const allowedSorts = ["created_at", "title", "sync_status"];
    const sort = allowedSorts.includes(sortBy) ? sortBy : "created_at";
    const order = sortOrder === "desc" ? "DESC" : "ASC";

    const totalRow = CountSchema.parse(
      db.prepare(`SELECT COUNT(*) as count FROM clips ${where}`).get(...params),
    );

    const offset = (page - 1) * pageSize;
    const clips = parseRows(
      ClipRowSchema,
      db
        .prepare(`SELECT * FROM clips ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset),
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
    return parseRows(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status = 'failed' AND retry_count < ? ORDER BY created_at ASC",
        )
        .all(maxRetries),
    );
  }

  function getRecentActivity(limit: number = 10): ClipRow[] {
    return parseRows(
      ClipRowSchema,
      db
        .prepare(
          "SELECT * FROM clips WHERE sync_status IN ('uploaded', 'failed', 'skipped') ORDER BY updated_at DESC LIMIT ?",
        )
        .all(limit),
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

  return {
    upsertFromArchive,
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
    getStats,
    getClipsPaginated,
    getFailedForRetry,
    getRecentActivity,
  };
}

export type ClipsRepository = ReturnType<typeof createClipsRepository>;
