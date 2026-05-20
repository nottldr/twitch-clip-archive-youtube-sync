import type Database from "better-sqlite3";

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "#server/config.js";
import { createTestDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createUploadsRepository } from "#server/db/repositories/uploads.js";
import { createSyncEngine } from "#server/sync/engine.js";
import { createScheduler } from "#server/sync/scheduler.js";

let tmpDir: string;
let archiveDir: string;
let dataDir: string;
let dbDir: string;
let clipsDir: string;

let db: Database.Database;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    googleClientId: "test-id",
    googleClientSecret: "test-secret",
    oauthRedirectBase: "http://localhost:3000",
    archivePath: archiveDir,
    dataPath: dataDir,
    port: 3000,
    dailyQuotaLimit: 10000,
    uploadCost: 100,
    uploadIntervalMs: 0,
    archivePollIntervalMs: 999_999,
    maxRetryCount: 3,
    logLevel: "error",
    dryRun: true,
    googleProjectNumber: null,
    descriptionTemplate: null,
    adminPassword: null,
    webhookUrl: null,
    webhookEvents: [],
    ignoredClipIds: [],
    ...overrides,
  } satisfies Config;
}

function writeDump(clips: Array<{ clip_id: string; created_at: string; title?: string }>) {
  const entries = clips.map((c, i) => ({
    model: "clips.clip",
    pk: i + 1,
    fields: {
      clip_id: c.clip_id,
      url: `https://www.twitch.tv/test/clip/${c.clip_id}`,
      embed_url: `https://clips.twitch.tv/embed?clip=${c.clip_id}`,
      broadcaster_id: 12345,
      broadcaster_name: "teststreamer",
      creator_id: 67890,
      creator_name: "testviewer",
      game_id: 509658,
      language: "en",
      title: c.title ?? `Clip ${c.clip_id}`,
      view_count: 100,
      created_at: c.created_at,
      thumbnail_url: "https://example.com/thumb.jpg",
      clip_archived: true,
      thumbnail_archived: true,
      deleted_on_twitch: false,
    },
  }));

  const filePath = resolve(dbDir, "dump_2026-01-01_00_00_00.json");
  writeFileSync(filePath, JSON.stringify(entries));
  // Atomic write contract: write a `.done` marker so the reader picks the dump up.
  writeFileSync(`${filePath}.done`, "");
  // Backstop for any leftover legacy-mode tests (cheap; harmless when ignored).
  const mtime = new Date(Date.now() - 120_000);
  utimesSync(filePath, mtime, mtime);
}

function createClipFile(clipId: string, size: number = 5000) {
  writeFileSync(resolve(clipsDir, `${clipId}.mp4`), Buffer.alloc(size));
}

function mockAuthManager(authenticated = true) {
  return {
    getAuthUrl: () => "https://example.com/auth",
    exchangeCode: async () => {},
    getAuthenticatedClient: async () => (authenticated ? ({} as any) : null),
    getOAuth2Client: async () => (authenticated ? ({} as any) : null),
    isAuthenticated: () => authenticated,
    revokeTokens: () => {},
  };
}

function mockEngineStateRepo() {
  let paused = false;
  return {
    isUserPaused: () => paused,
    setUserPaused: (v: boolean) => {
      paused = v;
    },
  };
}

beforeEach(() => {
  const id = randomUUID().slice(0, 8);
  tmpDir = resolve(import.meta.dirname, `../../__tests__/.tmp-engine-${id}`);
  archiveDir = resolve(tmpDir, "archive");
  dataDir = resolve(tmpDir, "data");
  dbDir = resolve(archiveDir, "db");
  clipsDir = resolve(archiveDir, "media/clips");
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(clipsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  db = createTestDb();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("sync engine with XState", () => {
  it("returns stopped state before start", () => {
    writeDump([]);
    const engine = createSyncEngine(
      makeConfig(),
      createClipsRepository(db),
      createUploadsRepository(db),
      createScheduler(createQuotaRepository(db), 10000, 100),
      mockAuthManager(),
      mockEngineStateRepo(),
    );
    expect(engine.getSnapshot().state).toBe("stopped");
  });

  it("transitions through starting states on start", () => {
    writeDump([{ clip_id: "clip-1", created_at: "2022-01-01T00:00:00Z" }]);
    createClipFile("clip-1");

    const states: string[] = [];
    const engine = createSyncEngine(
      makeConfig(),
      createClipsRepository(db),
      createUploadsRepository(db),
      createScheduler(createQuotaRepository(db), 10000, 100),
      mockAuthManager(),
      mockEngineStateRepo(),
      {
        onStateChange: (snapshot) => {
          states.push(snapshot.state);
        },
        onUploadProgress: () => {},
      },
    );

    engine.start();
    // Synchronous start should immediately enter starting state
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toBe("starting.importingArchive");
    engine.stop();
  });

  it("pauses via the public API after reaching active", async () => {
    writeDump([]);

    const reachedActive = Promise.withResolvers<void>();

    const engine = createSyncEngine(
      makeConfig(),
      createClipsRepository(db),
      createUploadsRepository(db),
      createScheduler(createQuotaRepository(db), 10000, 100),
      mockAuthManager(),
      mockEngineStateRepo(),
      {
        onStateChange: (snapshot) => {
          if (snapshot.state.startsWith("active.")) {
            reachedActive.resolve();
          }
        },
        onUploadProgress: () => {},
      },
    );

    engine.start();
    await reachedActive.promise;

    engine.pause();
    expect(engine.getSnapshot().state).toBe("active.blocked.userPaused");
    engine.stop();
  });

  it("resets failed clips and notifies machine", () => {
    writeDump([]);
    const clipsRepo = createClipsRepository(db);
    const engine = createSyncEngine(
      makeConfig(),
      clipsRepo,
      createUploadsRepository(db),
      createScheduler(createQuotaRepository(db), 10000, 100),
      mockAuthManager(),
      mockEngineStateRepo(),
    );

    clipsRepo.upsertFromArchive([
      {
        clipId: "fail-1",
        url: "https://twitch.tv/test/clip/fail-1",
        embedUrl: "https://clips.twitch.tv/embed?clip=fail-1",
        broadcasterId: 12345,
        broadcasterName: "test",
        creatorId: 67890,
        creatorName: "viewer",
        gameId: null,
        language: "en",
        title: "Failed clip",
        viewCount: 0,
        createdAt: "2022-01-01T00:00:00Z",
        thumbnailUrl: "https://example.com/thumb.jpg",
        clipArchived: true,
        thumbnailArchived: true,
        deletedOnTwitch: false,
      },
    ]);
    clipsRepo.markFailed("fail-1", "test error");

    expect(clipsRepo.getStats().failed).toBe(1);

    const result = engine.resetFailedClips();
    expect(result.reset).toBe(1);
    expect(clipsRepo.getStats().failed).toBe(0);
    expect(clipsRepo.getStats().pending).toBe(1);
  });

  it("handles debug flags", () => {
    writeDump([]);
    const engine = createSyncEngine(
      makeConfig(),
      createClipsRepository(db),
      createUploadsRepository(db),
      createScheduler(createQuotaRepository(db), 10000, 100),
      mockAuthManager(),
      mockEngineStateRepo(),
    );

    engine.setDebugFlag("fail", true);
    // Debug flags are in the XState context but we can verify via snapshot
    engine.setDebugFlag("fail", false);
    engine.clearDebugFlags();
    // No errors thrown = success
  });
});
