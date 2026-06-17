import type Database from "better-sqlite3";

import { z } from "zod/v4";

import { parseRow } from "../parse.js";

const MirrorPublishRowSchema = z.object({
  id: z.number(),
  attempted_at: z.string(),
  succeeded_at: z.string().nullable(),
  clip_count: z.number().nullable(),
  commit_sha: z.string().nullable(),
  error_message: z.string().nullable(),
});

export type MirrorPublishRow = z.infer<typeof MirrorPublishRowSchema>;

export function createMirrorPublishesRepository(db: Database.Database) {
  const insertSuccessStmt = db.prepare(
    "INSERT INTO mirror_publishes (succeeded_at, clip_count, commit_sha) VALUES (datetime('now'), ?, ?)",
  );
  const insertFailureStmt = db.prepare(
    "INSERT INTO mirror_publishes (error_message, clip_count) VALUES (?, ?)",
  );

  function recordSuccess(input: { clipCount: number; commitSha: string }): void {
    insertSuccessStmt.run(input.clipCount, input.commitSha);
  }

  function recordFailure(input: { errorMessage: string; clipCount?: number }): void {
    insertFailureStmt.run(input.errorMessage, input.clipCount ?? null);
  }

  function lastSuccess(): MirrorPublishRow | undefined {
    return parseRow(
      MirrorPublishRowSchema,
      db
        .prepare(
          "SELECT * FROM mirror_publishes WHERE succeeded_at IS NOT NULL ORDER BY id DESC LIMIT 1",
        )
        .get(),
    );
  }

  function lastAttempt(): MirrorPublishRow | undefined {
    return parseRow(
      MirrorPublishRowSchema,
      db.prepare("SELECT * FROM mirror_publishes ORDER BY id DESC LIMIT 1").get(),
    );
  }

  return { recordSuccess, recordFailure, lastSuccess, lastAttempt };
}

export type MirrorPublishesRepository = ReturnType<typeof createMirrorPublishesRepository>;
