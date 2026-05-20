import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { createTestDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createEngineLogRepository } from "#server/db/repositories/engine-log.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createUploadsRepository } from "#server/db/repositories/uploads.js";

let db: Database.Database;
let clipsRepo: ReturnType<typeof createClipsRepository>;
let uploadsRepo: ReturnType<typeof createUploadsRepository>;
let quotaRepo: ReturnType<typeof createQuotaRepository>;
let logRepo: ReturnType<typeof createEngineLogRepository>;

const ClipRowProbe = z.object({
  sync_status: z.string(),
  youtube_id: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  last_error: z.string().nullable(),
  retry_count: z.number(),
});

const AttemptRowProbe = z.object({
  id: z.number(),
  success: z.number(),
  completed_at: z.string().nullable(),
  youtube_id: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
});

function seedClip(clipId: string = "c1") {
  clipsRepo.upsertFromArchive([
    {
      clipId,
      url: "u",
      embedUrl: "e",
      broadcasterId: 1,
      broadcasterName: "b",
      creatorId: 2,
      creatorName: "c",
      gameId: null,
      language: "en",
      title: `Title ${clipId}`,
      viewCount: 0,
      createdAt: "2026-01-01T00:00:00Z",
      thumbnailUrl: "t",
      clipArchived: true,
      thumbnailArchived: true,
      deletedOnTwitch: false,
    },
  ]);
  clipsRepo.markUploading(clipId);
}

function readClip(clipId: string) {
  return ClipRowProbe.parse(
    db
      .prepare(
        "SELECT sync_status, youtube_id, uploaded_at, last_error, retry_count FROM clips WHERE clip_id = ?",
      )
      .get(clipId),
  );
}

function readAttempt(attemptId: number) {
  return AttemptRowProbe.parse(
    db
      .prepare(
        "SELECT id, success, completed_at, youtube_id, error_code, error_message FROM upload_attempts WHERE id = ?",
      )
      .get(attemptId),
  );
}

function readQuotaUsage(date: string): { units_used: number; uploads_count: number } {
  const row = db
    .prepare("SELECT units_used, uploads_count FROM quota_usage WHERE date_pt = ?")
    .get(date) as { units_used: number; uploads_count: number } | undefined;
  return row ?? { units_used: 0, uploads_count: 0 };
}

beforeEach(() => {
  db = createTestDb();
  clipsRepo = createClipsRepository(db);
  logRepo = createEngineLogRepository(db);
  uploadsRepo = createUploadsRepository(db, logRepo);
  quotaRepo = createQuotaRepository(db);
});

afterEach(() => {
  db.close();
});

describe("recordSuccess", () => {
  it("atomically marks clip uploaded, completes attempt, and records quota", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    uploadsRepo.recordSuccess({
      clipId: "c1",
      attemptId,
      youtubeId: "yt-1",
      quotaCost: 1600,
      datePt: "2026-05-20",
    });

    const clip = readClip("c1");
    expect(clip.sync_status).toBe("uploaded");
    expect(clip.youtube_id).toBe("yt-1");
    expect(clip.uploaded_at).toBeTruthy();

    const attempt = readAttempt(attemptId);
    expect(attempt.success).toBe(1);
    expect(attempt.completed_at).toBeTruthy();
    expect(attempt.youtube_id).toBe("yt-1");

    const usage = readQuotaUsage("2026-05-20");
    expect(usage.units_used).toBe(1600);
    expect(usage.uploads_count).toBe(1);
  });

  it("accumulates quota across multiple successful records on the same date", () => {
    seedClip("c1");
    seedClip("c2");
    const a1 = uploadsRepo.logAttempt("c1", 1600);
    const a2 = uploadsRepo.logAttempt("c2", 1600);

    uploadsRepo.recordSuccess({
      clipId: "c1",
      attemptId: a1,
      youtubeId: "yt-1",
      quotaCost: 1600,
      datePt: "2026-05-20",
    });
    uploadsRepo.recordSuccess({
      clipId: "c2",
      attemptId: a2,
      youtubeId: "yt-2",
      quotaCost: 1600,
      datePt: "2026-05-20",
    });

    const usage = readQuotaUsage("2026-05-20");
    expect(usage.units_used).toBe(3200);
    expect(usage.uploads_count).toBe(2);
  });

  it("rolls back ALL writes if any inner statement throws", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    // Sabotage the clips UPDATE statement so the transaction throws partway through.
    // The previous attempt insert and any prior quota row should remain unaffected;
    // crucially, the upload_attempt should NOT be marked complete and quota should
    // NOT be incremented for this attempt.
    const realPrepare = db.prepare.bind(db);
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      if (sql.includes("UPDATE clips SET sync_status = 'uploaded'")) {
        return {
          run: () => {
            throw new Error("simulated mid-tx failure");
          },
        } as unknown as ReturnType<typeof db.prepare>;
      }
      return realPrepare(sql);
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    }) as typeof db.prepare;

    expect(() => {
      uploadsRepo.recordSuccess({
        clipId: "c1",
        attemptId,
        youtubeId: "yt-1",
        quotaCost: 1600,
        datePt: "2026-05-20",
      });
    }).toThrow("simulated mid-tx failure");

    // Restore for our probes
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = realPrepare;

    const clip = readClip("c1");
    expect(clip.sync_status).toBe("uploading"); // still in the pre-transaction state
    expect(clip.youtube_id).toBeNull();

    const attempt = readAttempt(attemptId);
    expect(attempt.success).toBe(0); // attempt row was created by logAttempt but never completed
    expect(attempt.completed_at).toBeNull();

    const usage = readQuotaUsage("2026-05-20");
    expect(usage.units_used).toBe(0);
    expect(usage.uploads_count).toBe(0);
  });
});

describe("getAttemptsByClip", () => {
  it("returns the per-clip attempt history newest first", () => {
    seedClip("c1");
    seedClip("c2");
    const a1 = uploadsRepo.logAttempt("c1", 1600);
    uploadsRepo.recordFailure({
      clipId: "c1",
      attemptId: a1,
      errorMessage: "boom",
      errorCode: "SERVER_ERROR",
    });

    const a2 = uploadsRepo.logAttempt("c1", 1600);
    uploadsRepo.recordSuccess({
      clipId: "c1",
      attemptId: a2,
      youtubeId: "yt-c1",
      quotaCost: 1600,
      datePt: "2026-05-20",
    });

    // Different clip — should not show up
    uploadsRepo.logAttempt("c2", 1600);

    const result = uploadsRepo.getAttemptsByClip("c1", { limit: 10 });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].id).toBe(a2); // newest first
    expect(result.attempts[0].success).toBe(1);
    expect(result.attempts[1].id).toBe(a1);
    expect(result.attempts[1].success).toBe(0);
    expect(result.attempts[1].error_code).toBe("SERVER_ERROR");
    expect(result.hasMore).toBe(false);
  });

  it("paginates via beforeId", () => {
    seedClip("c1");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(uploadsRepo.logAttempt("c1", 1600));

    const first = uploadsRepo.getAttemptsByClip("c1", { limit: 2 });
    expect(first.attempts).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const next = uploadsRepo.getAttemptsByClip("c1", { limit: 2, beforeId: first.attempts[1].id });
    expect(next.attempts).toHaveLength(2);
    expect(next.attempts[0].id).toBeLessThan(first.attempts[1].id);
  });

  it("returns empty for a clip with no attempts", () => {
    seedClip("c1");
    const result = uploadsRepo.getAttemptsByClip("c1", { limit: 10 });
    expect(result.attempts).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

describe("engine_log audit trail", () => {
  it("recordSuccess writes a type='upload' row with the youtube_id", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    uploadsRepo.recordSuccess({
      clipId: "c1",
      attemptId,
      youtubeId: "yt-abc",
      quotaCost: 1600,
      datePt: "2026-05-20",
    });

    const { entries } = logRepo.query({ types: ["upload"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("upload");
    expect(entries[0].clip_id).toBe("c1");
    expect(entries[0].youtube_id).toBe("yt-abc");
    expect(entries[0].error).toBeNull();
  });

  it("recordFailure writes a type='upload' row with the error_code", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    uploadsRepo.recordFailure({
      clipId: "c1",
      attemptId,
      errorMessage: "boom",
      errorCode: "SERVER_ERROR",
    });

    const { entries } = logRepo.query({ types: ["upload"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("upload");
    expect(entries[0].clip_id).toBe("c1");
    expect(entries[0].youtube_id).toBeNull();
    expect(entries[0].error).toBe("SERVER_ERROR: boom");
  });

  it("recordSystemFailure writes a type='upload' row with system error context", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    uploadsRepo.recordSystemFailure({
      attemptId,
      clipId: "c1",
      errorMessage: "daily quota exceeded",
      errorCode: "QUOTA_EXCEEDED",
    });

    const { entries } = logRepo.query({ types: ["upload"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("upload");
    expect(entries[0].clip_id).toBe("c1");
    expect(entries[0].error).toBe("QUOTA_EXCEEDED: daily quota exceeded");
  });

  it("log row is rolled back if the transaction fails", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    const realPrepare = db.prepare.bind(db);
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      if (sql.includes("UPDATE clips SET sync_status = 'uploaded'")) {
        return {
          run: () => {
            throw new Error("simulated mid-tx failure");
          },
        } as unknown as ReturnType<typeof db.prepare>;
      }
      return realPrepare(sql);
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    }) as typeof db.prepare;

    expect(() => {
      uploadsRepo.recordSuccess({
        clipId: "c1",
        attemptId,
        youtubeId: "yt-1",
        quotaCost: 1600,
        datePt: "2026-05-20",
      });
    }).toThrow();

    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = realPrepare;

    const { entries } = logRepo.query({ types: ["upload"] });
    expect(entries).toHaveLength(0);
  });
});

describe("recordFailure", () => {
  it("atomically marks clip failed (increments retry_count) and completes attempt", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    uploadsRepo.recordFailure({
      clipId: "c1",
      attemptId,
      errorMessage: "boom",
      errorCode: "SERVER_ERROR",
    });

    const clip = readClip("c1");
    expect(clip.sync_status).toBe("failed");
    expect(clip.last_error).toBe("SERVER_ERROR: boom");
    expect(clip.retry_count).toBe(1);
    expect(clip.youtube_id).toBeNull();

    const attempt = readAttempt(attemptId);
    expect(attempt.success).toBe(0);
    expect(attempt.completed_at).toBeTruthy();
    expect(attempt.error_code).toBe("SERVER_ERROR");
    expect(attempt.error_message).toBe("boom");
  });

  it("does not touch quota_usage", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);
    quotaRepo.recordUpload("2026-05-20", 1600); // seed a prior successful row

    uploadsRepo.recordFailure({
      clipId: "c1",
      attemptId,
      errorMessage: "boom",
      errorCode: "SERVER_ERROR",
    });

    const usage = readQuotaUsage("2026-05-20");
    // Failure should not have touched quota
    expect(usage.units_used).toBe(1600);
    expect(usage.uploads_count).toBe(1);
  });

  it("rolls back if any inner statement throws", () => {
    seedClip("c1");
    const attemptId = uploadsRepo.logAttempt("c1", 1600);

    const realPrepare = db.prepare.bind(db);
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      if (sql.includes("UPDATE clips SET sync_status = 'failed'")) {
        return {
          run: () => {
            throw new Error("boom");
          },
        } as unknown as ReturnType<typeof db.prepare>;
      }
      return realPrepare(sql);
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    }) as typeof db.prepare;

    expect(() => {
      uploadsRepo.recordFailure({
        clipId: "c1",
        attemptId,
        errorMessage: "boom",
        errorCode: "SERVER_ERROR",
      });
    }).toThrow("boom");

    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test-only sabotage
    (db as { prepare: typeof db.prepare }).prepare = realPrepare;

    const clip = readClip("c1");
    expect(clip.sync_status).toBe("uploading");
    expect(clip.retry_count).toBe(0);
    expect(clip.last_error).toBeNull();

    const attempt = readAttempt(attemptId);
    expect(attempt.completed_at).toBeNull();
    expect(attempt.error_code).toBeNull();
  });
});
