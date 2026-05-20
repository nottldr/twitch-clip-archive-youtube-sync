import type Database from "better-sqlite3";

import { z } from "zod/v4";

import { parseRowsLenient } from "../parse.js";

export const LogTypeSchema = z.enum(["state_change", "upload", "error"]);

export type LogType = z.infer<typeof LogTypeSchema>;

const LogRowSchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  type: LogTypeSchema,
  from_state: z.string().nullable(),
  to_state: z.string().nullable(),
  event: z.string().nullable(),
  clip_id: z.string().nullable(),
  youtube_id: z.string().nullable(),
  error: z.string().nullable(),
  message: z.string(),
});

export type LogRow = z.infer<typeof LogRowSchema>;

const MAX_LOG_ROWS = 100_000;

export function createEngineLogRepository(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT INTO engine_log (type, from_state, to_state, event, clip_id, youtube_id, error, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function insert(entry: {
    type: LogType;
    fromState?: string | null;
    toState?: string | null;
    event?: string | null;
    clipId?: string | null;
    youtubeId?: string | null;
    error?: string | null;
    message: string;
  }): void {
    insertStmt.run(
      entry.type,
      entry.fromState ?? null,
      entry.toState ?? null,
      entry.event ?? null,
      entry.clipId ?? null,
      entry.youtubeId ?? null,
      entry.error ?? null,
      entry.message,
    );
  }

  function query(filters: { types?: string[]; limit?: number; beforeId?: number }): {
    entries: LogRow[];
    hasMore: boolean;
  } {
    const limit = Math.min(filters.limit ?? 50, 200);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.types && filters.types.length > 0) {
      const placeholders = filters.types.map(() => "?").join(", ");
      conditions.push(`type IN (${placeholders})`);
      params.push(...filters.types);
    }

    if (filters.beforeId) {
      conditions.push("id < ?");
      params.push(filters.beforeId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM engine_log ${where} ORDER BY id DESC LIMIT ?`;
    params.push(limit + 1); // fetch one extra to check hasMore

    const rows = parseRowsLenient(LogRowSchema, db.prepare(sql).all(...params), "engineLog.query");
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;

    return {
      entries: entries.map((row) => ({
        ...row,
        // Map snake_case to camelCase for the API
        fromState: row.from_state,
        toState: row.to_state,
        clipId: row.clip_id,
        youtubeId: row.youtube_id,
      })),
      hasMore,
    };
  }

  function prune(): number {
    const result = db
      .prepare(
        `DELETE FROM engine_log WHERE id NOT IN (
          SELECT id FROM engine_log ORDER BY id DESC LIMIT ?
        )`,
      )
      .run(MAX_LOG_ROWS);
    return result.changes;
  }

  function clear(): void {
    db.prepare("DELETE FROM engine_log").run();
  }

  return {
    insert,
    query,
    prune,
    clear,
  };
}

export type EngineLogRepository = ReturnType<typeof createEngineLogRepository>;
