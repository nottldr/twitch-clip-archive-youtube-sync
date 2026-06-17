import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TwitchClip } from "#server/archive/types.js";
import { createTestDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { buildSnapshot } from "#server/mirror/builder.js";

let db: Database.Database;
let clipsRepo: ReturnType<typeof createClipsRepository>;

function clip(overrides: Partial<TwitchClip>): TwitchClip {
  return {
    clipId: "x",
    url: "https://twitch.tv/x",
    embedUrl: "e",
    broadcasterId: 1,
    broadcasterName: "broad",
    creatorId: 2,
    creatorName: "creator",
    gameId: null,
    language: "en",
    title: "title",
    viewCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    thumbnailUrl: "t",
    clipArchived: true,
    thumbnailArchived: true,
    deletedOnTwitch: false,
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  clipsRepo = createClipsRepository(db);
});

afterEach(() => {
  db.close();
});

describe("buildSnapshot", () => {
  it("emits a parseable JSON array sorted by (created_at, clip_id)", () => {
    clipsRepo.upsertFromArchive([
      clip({ clipId: "b", createdAt: "2026-01-02T00:00:00Z" }),
      clip({ clipId: "a-late", createdAt: "2026-01-03T00:00:00Z" }),
      clip({ clipId: "a-early", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "tie-b", createdAt: "2026-01-02T00:00:00Z" }),
    ]);

    const snap = buildSnapshot(clipsRepo);
    const parsed = JSON.parse(snap.clipsJson) as { clip_id: string }[];

    expect(parsed.map((c) => c.clip_id)).toEqual([
      "a-early", // earliest created_at
      "b", // tied with tie-b at 2026-01-02, sorts before by clip_id
      "tie-b",
      "a-late", // latest created_at
    ]);
  });

  it("strips operational and internal columns from public rows", () => {
    clipsRepo.upsertFromArchive([clip({ clipId: "k" })]);
    const snap = buildSnapshot(clipsRepo);
    const [row] = JSON.parse(snap.clipsJson) as Record<string, unknown>[];

    const blocked = [
      "embed_url",
      "broadcaster_id",
      "creator_id",
      "clip_archived",
      "thumbnail_archived",
      "last_error",
      "retry_count",
      "first_seen_at",
      "updated_at",
    ];
    for (const col of blocked) {
      expect(row).not.toHaveProperty(col);
    }
    expect(row).toHaveProperty("clip_id", "k");
    expect(row).toHaveProperty("title", "title");
  });

  it("emits deterministic bytes regardless of insert order (canonical key sort)", () => {
    clipsRepo.upsertFromArchive([
      clip({ clipId: "z", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "a", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "m", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    const first = buildSnapshot(clipsRepo).clipsJson;

    const db2 = createTestDb();
    const repo2 = createClipsRepository(db2);
    repo2.upsertFromArchive([
      clip({ clipId: "a", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "m", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "z", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    const second = buildSnapshot(repo2).clipsJson;
    db2.close();

    expect(first).toBe(second);
  });

  it("uses 2-space pretty layout (one field per line)", () => {
    clipsRepo.upsertFromArchive([clip({ clipId: "k" })]);
    const snap = buildSnapshot(clipsRepo);

    expect(snap.clipsJson.startsWith("[\n  {\n")).toBe(true);
    expect(snap.clipsJson.endsWith("\n  }\n]")).toBe(true);
    // Each top-level key is indented exactly 4 spaces (inside `{ }` inside `[ ]`).
    expect(snap.clipsJson).toContain('\n    "clip_id": "k",');
  });

  it("flipping one clip's sync_status produces a one-line diff", () => {
    clipsRepo.upsertFromArchive([
      clip({ clipId: "a", createdAt: "2026-01-01T00:00:00Z" }),
      clip({ clipId: "b", createdAt: "2026-01-02T00:00:00Z" }),
      clip({ clipId: "c", createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    const before = buildSnapshot(clipsRepo).clipsJson;

    clipsRepo.markUploaded("b", "yt-b");
    const after = buildSnapshot(clipsRepo).clipsJson;

    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines).toHaveLength(beforeLines.length);

    // youtube_id flips null → "yt-b", uploaded_at flips null → some ISO,
    // sync_status flips "pending" → "uploaded". So we expect 3 lines changed,
    // all inside clip "b"'s block, all other rows unchanged.
    let changed = 0;
    for (const [i, line] of beforeLines.entries()) {
      if (line !== afterLines[i]) changed++;
    }
    expect(changed).toBe(3);
  });

  it("manifest has schema_version, clip_count, and by_status totals", () => {
    clipsRepo.upsertFromArchive([clip({ clipId: "a" }), clip({ clipId: "b" })]);
    clipsRepo.markUploaded("a", "yt-a");

    const snap = buildSnapshot(clipsRepo);
    expect(snap.manifest.schema_version).toBe(1);
    expect(snap.manifest.clip_count).toBe(2);
    expect(snap.manifest.by_status.uploaded).toBe(1);
    expect(snap.manifest.by_status.pending).toBe(1);

    expect(JSON.parse(snap.manifestJson)).toEqual(snap.manifest);
  });
});
