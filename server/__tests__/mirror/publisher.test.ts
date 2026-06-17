import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TwitchClip } from "#server/archive/types.js";
import { createTestDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createMirrorPublishesRepository } from "#server/db/repositories/mirror-publishes.js";
import { publishNow } from "#server/mirror/publisher.js";

let db: Database.Database;
let clipsRepo: ReturnType<typeof createClipsRepository>;
let mirrorRepo: ReturnType<typeof createMirrorPublishesRepository>;

const CFG = { token: "tok", owner: "me", repo: "mirror", branch: "main" };

function clip(overrides: Partial<TwitchClip>): TwitchClip {
  return {
    clipId: "x",
    url: "u",
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

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  globalThis.fetch = vi.fn(async () => {
    const next = queue.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(() => {
  db = createTestDb();
  clipsRepo = createClipsRepository(db);
  mirrorRepo = createMirrorPublishesRepository(db);
  clipsRepo.upsertFromArchive([clip({ clipId: "a" }), clip({ clipId: "b" })]);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("publishNow", () => {
  it("happy path: pushes both files and records success", async () => {
    mockFetch([
      { status: 404, body: {} }, // GET clips.json
      { status: 201, body: { commit: { sha: "clips-sha" } } }, // PUT clips.json
      { status: 404, body: {} }, // GET manifest.json
      { status: 201, body: { commit: { sha: "manifest-sha" } } }, // PUT manifest.json
    ]);

    const outcome = await publishNow({ config: CFG, clipsRepo, mirrorRepo });
    expect(outcome.ok).toBe(true);
    expect(outcome.clipCount).toBe(2);
    expect(outcome.commitSha).toBe("manifest-sha");

    const last = mirrorRepo.lastSuccess();
    expect(last?.commit_sha).toBe("manifest-sha");
    expect(last?.clip_count).toBe(2);
  });

  it("records failure when GitHub returns an error", async () => {
    mockFetch([
      { status: 401, body: { message: "bad creds" } }, // GET clips.json → not 404, throws
    ]);

    const outcome = await publishNow({ config: CFG, clipsRepo, mirrorRepo });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("401");

    const last = mirrorRepo.lastAttempt();
    expect(last?.succeeded_at).toBeNull();
    expect(last?.error_message).toContain("401");
  });

  it("returns a 'not configured' outcome when config is null without touching fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const outcome = await publishNow({ config: null, clipsRepo, mirrorRepo });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
