import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TwitchClip } from "#server/archive/types.js";
import { createTestDb } from "#server/db/connection.js";
import { ClipRowSchema, createClipsRepository } from "#server/db/repositories/clips.js";

let db: Database.Database;
let repo: ReturnType<typeof createClipsRepository>;

function makeClip(overrides: Partial<TwitchClip> = {}): TwitchClip {
  return {
    clipId: "clip-1",
    url: "https://twitch.tv/test/clip/clip-1",
    embedUrl: "https://clips.twitch.tv/embed?clip=clip-1",
    broadcasterId: 12345,
    broadcasterName: "teststreamer",
    creatorId: 67890,
    creatorName: "testviewer",
    gameId: 509658,
    language: "en",
    title: "Test clip",
    viewCount: 100,
    createdAt: "2022-01-01T00:00:00Z",
    thumbnailUrl: "https://example.com/thumb.jpg",
    clipArchived: true,
    thumbnailArchived: true,
    deletedOnTwitch: false,
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  repo = createClipsRepository(db);
});

afterEach(() => {
  db.close();
});

describe("upsertFromArchive", () => {
  it("inserts new clips", () => {
    const clips = [
      makeClip({ clipId: "clip-1", createdAt: "2022-01-01T00:00:00Z" }),
      makeClip({ clipId: "clip-2", createdAt: "2022-02-01T00:00:00Z" }),
    ];

    repo.upsertFromArchive(clips);

    const stats = repo.getStats();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
  });

  it("does not create duplicates on re-upsert", () => {
    const clip = makeClip({ clipId: "clip-1" });
    repo.upsertFromArchive([clip]);
    repo.upsertFromArchive([clip]);

    const stats = repo.getStats();
    expect(stats.total).toBe(1);
  });

  it("updates metadata but preserves sync state", () => {
    const clip = makeClip({ clipId: "clip-1", title: "Original title" });
    repo.upsertFromArchive([clip]);

    // Upload it
    repo.markUploading("clip-1");
    repo.markUploaded("clip-1", "yt-123");

    // Re-upsert with new title
    repo.upsertFromArchive([makeClip({ clipId: "clip-1", title: "Updated title" })]);

    // Title should update but sync state should not
    const row = db
      .prepare("SELECT title, sync_status, youtube_id FROM clips WHERE clip_id = ?")
      .get("clip-1") as { title: string; sync_status: string; youtube_id: string };

    expect(row.title).toBe("Updated title");
    expect(row.sync_status).toBe("uploaded");
    expect(row.youtube_id).toBe("yt-123");
  });
});

describe("getNextPending", () => {
  it("returns clips ordered by created_at ASC", () => {
    repo.upsertFromArchive([
      makeClip({ clipId: "newer", createdAt: "2023-06-01T00:00:00Z" }),
      makeClip({ clipId: "older", createdAt: "2021-01-01T00:00:00Z" }),
    ]);

    const next = repo.getNextPending();
    expect(next?.clip_id).toBe("older");
  });

  it("returns undefined when no pending clips", () => {
    expect(repo.getNextPending()).toBeUndefined();
  });
});

describe("state transitions", () => {
  it("markUploading sets status", () => {
    repo.upsertFromArchive([makeClip()]);
    repo.markUploading("clip-1");

    const row = db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("clip-1") as {
      sync_status: string;
    };
    expect(row.sync_status).toBe("uploading");
  });

  it("markUploaded sets status, youtube_id, and uploaded_at", () => {
    repo.upsertFromArchive([makeClip()]);
    repo.markUploading("clip-1");
    repo.markUploaded("clip-1", "yt-abc");

    const row = db
      .prepare("SELECT sync_status, youtube_id, uploaded_at FROM clips WHERE clip_id = ?")
      .get("clip-1") as { sync_status: string; youtube_id: string; uploaded_at: string };
    expect(row.sync_status).toBe("uploaded");
    expect(row.youtube_id).toBe("yt-abc");
    expect(row.uploaded_at).toBeTruthy();
  });

  it("markFailed increments retry_count", () => {
    repo.upsertFromArchive([makeClip()]);
    repo.markFailed("clip-1", "quota exceeded");
    repo.markFailed("clip-1", "timeout");

    const row = db
      .prepare("SELECT sync_status, retry_count, last_error FROM clips WHERE clip_id = ?")
      .get("clip-1") as { sync_status: string; retry_count: number; last_error: string };
    expect(row.sync_status).toBe("failed");
    expect(row.retry_count).toBe(2);
    expect(row.last_error).toBe("timeout");
  });

  it("markSkipped sets status and reason", () => {
    repo.upsertFromArchive([makeClip()]);
    repo.markSkipped("clip-1", "MP4 file not found");

    const row = db
      .prepare("SELECT sync_status, last_error FROM clips WHERE clip_id = ?")
      .get("clip-1") as { sync_status: string; last_error: string };
    expect(row.sync_status).toBe("skipped");
    expect(row.last_error).toBe("MP4 file not found");
  });
});

describe("resetInterrupted", () => {
  it("resets uploading clips to pending", () => {
    repo.upsertFromArchive([makeClip({ clipId: "clip-1" }), makeClip({ clipId: "clip-2" })]);
    repo.markUploading("clip-1");
    // clip-2 stays pending

    const result = repo.resetInterrupted();
    expect(result.reset).toBe(1);
    expect(result.promoted).toBe(0);

    const row = db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("clip-1") as {
      sync_status: string;
    };
    expect(row.sync_status).toBe("pending");
  });

  it("promotes uploading clips that already have a youtube_id to uploaded", () => {
    repo.upsertFromArchive([makeClip({ clipId: "clip-1" })]);
    repo.markUploading("clip-1");
    // Simulate: upload succeeded (youtube_id set) but markUploaded crashed mid-flight,
    // leaving status='uploading' with youtube_id populated.
    db.prepare("UPDATE clips SET youtube_id = ? WHERE clip_id = ?").run("yt-survivor", "clip-1");

    const result = repo.resetInterrupted();
    expect(result.reset).toBe(0);
    expect(result.promoted).toBe(1);

    const row = db
      .prepare("SELECT sync_status, youtube_id, uploaded_at FROM clips WHERE clip_id = ?")
      .get("clip-1") as { sync_status: string; youtube_id: string; uploaded_at: string };
    expect(row.sync_status).toBe("uploaded");
    expect(row.youtube_id).toBe("yt-survivor");
    expect(row.uploaded_at).toBeTruthy();
  });

  it("does not touch rows with non-uploading status", () => {
    repo.upsertFromArchive([
      makeClip({ clipId: "u" }),
      makeClip({ clipId: "p" }),
      makeClip({ clipId: "f" }),
    ]);
    repo.markUploading("u");
    repo.markUploaded("u", "yt-1");
    repo.markFailed("f", "boom");

    const result = repo.resetInterrupted();
    expect(result.reset).toBe(0);
    expect(result.promoted).toBe(0);

    expect(
      (
        db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("u") as {
          sync_status: string;
        }
      ).sync_status,
    ).toBe("uploaded");
    expect(
      (
        db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("p") as {
          sync_status: string;
        }
      ).sync_status,
    ).toBe("pending");
    expect(
      (
        db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("f") as {
          sync_status: string;
        }
      ).sync_status,
    ).toBe("failed");
  });

  it("handles a mix of recoverable and unrecoverable interrupted rows atomically", () => {
    repo.upsertFromArchive([makeClip({ clipId: "lost" }), makeClip({ clipId: "saved" })]);
    repo.markUploading("lost");
    repo.markUploading("saved");
    db.prepare("UPDATE clips SET youtube_id = ? WHERE clip_id = ?").run("yt-saved", "saved");

    const result = repo.resetInterrupted();
    expect(result.reset).toBe(1);
    expect(result.promoted).toBe(1);

    expect(
      (
        db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("lost") as {
          sync_status: string;
        }
      ).sync_status,
    ).toBe("pending");
    expect(
      (
        db.prepare("SELECT sync_status FROM clips WHERE clip_id = ?").get("saved") as {
          sync_status: string;
        }
      ).sync_status,
    ).toBe("uploaded");
  });
});

describe("getStats", () => {
  it("returns accurate counts", () => {
    repo.upsertFromArchive([
      makeClip({ clipId: "a" }),
      makeClip({ clipId: "b" }),
      makeClip({ clipId: "c" }),
    ]);
    repo.markUploading("a");
    repo.markUploaded("a", "yt-1");
    repo.markFailed("b", "error");

    const stats = repo.getStats();
    expect(stats.total).toBe(3);
    expect(stats.uploaded).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(1);
  });
});

describe("getFailedForRetry", () => {
  it("returns failed clips under max retries", () => {
    repo.upsertFromArchive([makeClip({ clipId: "a" }), makeClip({ clipId: "b" })]);
    repo.markFailed("a", "e1");
    repo.markFailed("a", "e2");
    repo.markFailed("a", "e3"); // retry_count = 3
    repo.markFailed("b", "e1"); // retry_count = 1

    const retryable = repo.getFailedForRetry(3);
    expect(retryable).toHaveLength(1);
    expect(retryable[0].clip_id).toBe("b");
  });
});

describe("ClipRowSchema sync_status", () => {
  const baseRow = {
    clip_id: "x",
    title: "t",
    url: "u",
    embed_url: "e",
    broadcaster_id: 1,
    broadcaster_name: "b",
    creator_id: 2,
    creator_name: "c",
    game_id: null,
    language: null,
    view_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    thumbnail_url: null,
    clip_archived: 1,
    thumbnail_archived: 1,
    deleted_on_twitch: 0,
    youtube_id: null,
    uploaded_at: null,
    last_error: null,
    retry_count: 0,
    first_seen_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  for (const status of [
    "pending",
    "uploading",
    "uploaded",
    "failed",
    "skipped",
    "ignored",
  ] as const) {
    it(`accepts valid sync_status="${status}"`, () => {
      const result = ClipRowSchema.safeParse({ ...baseRow, sync_status: status });
      expect(result.success).toBe(true);
    });
  }

  it("rejects an unknown sync_status value", () => {
    const result = ClipRowSchema.safeParse({ ...baseRow, sync_status: "bogus" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty sync_status value", () => {
    const result = ClipRowSchema.safeParse({ ...baseRow, sync_status: "" });
    expect(result.success).toBe(false);
  });
});

describe("getClipsPaginated", () => {
  it("paginates results", () => {
    const clips = Array.from({ length: 5 }, (_, i) =>
      makeClip({ clipId: `clip-${i}`, createdAt: `2022-0${i + 1}-01T00:00:00Z` }),
    );
    repo.upsertFromArchive(clips);

    const page1 = repo.getClipsPaginated({ page: 1, pageSize: 2 });
    expect(page1.clips).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page3 = repo.getClipsPaginated({ page: 3, pageSize: 2 });
    expect(page3.clips).toHaveLength(1);
  });

  it("filters by status", () => {
    repo.upsertFromArchive([makeClip({ clipId: "a" }), makeClip({ clipId: "b" })]);
    repo.markUploading("a");
    repo.markUploaded("a", "yt-1");

    const result = repo.getClipsPaginated({ statuses: ["uploaded"] });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].clip_id).toBe("a");
  });

  it("searches by title", () => {
    repo.upsertFromArchive([
      makeClip({ clipId: "a", title: "Amazing headshot" }),
      makeClip({ clipId: "b", title: "Boring moment" }),
    ]);

    const result = repo.getClipsPaginated({ search: "headshot" });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].clip_id).toBe("a");
  });
});
