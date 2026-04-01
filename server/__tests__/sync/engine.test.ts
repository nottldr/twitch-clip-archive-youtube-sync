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
import { type EngineEventHandler, createSyncEngine } from "#server/sync/engine.js";
import { createScheduler } from "#server/sync/scheduler.js";

// Use unique dirs per test run to avoid parallel collisions
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
    archivePollIntervalMs: 999999,
    maxRetryCount: 3,
    logLevel: "error",
    dryRun: true,
    syncMode: "auto" as const,
    googleProjectNumber: null,
    descriptionTemplate: null,
    adminPassword: null,
    webhookUrl: null,
    webhookEvents: [],
    ...overrides,
  } as Config;
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
  const mtime = new Date(Date.now() - 120_000);
  utimesSync(filePath, mtime, mtime);
}

function createClipFile(clipId: string, size: number = 5000) {
  writeFileSync(resolve(clipsDir, `${clipId}.mp4`), Buffer.alloc(size));
}

function setup(clipData: Array<{ clip_id: string; created_at: string }>) {
  writeDump(clipData);
  for (const c of clipData) {
    createClipFile(c.clip_id);
  }
}

// Mock auth manager that always returns authenticated
function mockAuthManager(authenticated = true) {
  return {
    getAuthUrl: () => "https://example.com/auth",
    exchangeCode: async () => {},
    getAuthenticatedClient: async () => (authenticated ? ({} as any) : null),
    isAuthenticated: () => authenticated,
    revokeTokens: () => {},
  };
}

function trackEvents(): {
  events: Array<{ type: string; data: unknown }>;
  handler: EngineEventHandler;
} {
  const events: Array<{ type: string; data: unknown }> = [];
  return {
    events,
    handler: {
      onUploadSuccess: (clipId, youtubeId) =>
        events.push({ type: "upload:success", data: { clipId, youtubeId } }),
      onUploadFailure: (clipId, error) =>
        events.push({ type: "upload:failure", data: { clipId, error } }),
      onQuotaExhausted: () => events.push({ type: "quota:exhausted", data: {} }),
      onSyncError: (error) => events.push({ type: "sync:error", data: { error } }),
      onStatusChange: (status) => events.push({ type: "status:change", data: { status } }),
      onAuthComplete: () => {},
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

describe("processNextClip (dry run)", () => {
  it("processes pending clips in created_at ASC order", async () => {
    setup([
      { clip_id: "newer", created_at: "2023-06-01T00:00:00Z" },
      { clip_id: "older", created_at: "2021-01-01T00:00:00Z" },
    ]);

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);
    const { events, handler } = trackEvents();

    const engine = createSyncEngine(
      config,
      clipsRepo,
      uploadsRepo,
      scheduler,
      mockAuthManager(),
      handler,
    );

    // Import archive
    engine.importArchive();

    // Process first clip
    await engine.processNextClip();
    const successEvents = events.filter((e) => e.type === "upload:success");
    expect(successEvents).toHaveLength(1);
    expect((successEvents[0].data as any).clipId).toBe("older");

    // Process second clip
    await engine.processNextClip();
    const allSuccess = events.filter((e) => e.type === "upload:success");
    expect(allSuccess).toHaveLength(2);
    expect((allSuccess[1].data as any).clipId).toBe("newer");
  });

  it("stops on quota exhaustion", async () => {
    setup([
      { clip_id: "clip-1", created_at: "2022-01-01T00:00:00Z" },
      { clip_id: "clip-2", created_at: "2022-02-01T00:00:00Z" },
    ]);

    const config = makeConfig({ dailyQuotaLimit: 100, uploadCost: 100 });
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 100, 100);
    const { events, handler } = trackEvents();

    const engine = createSyncEngine(
      config,
      clipsRepo,
      uploadsRepo,
      scheduler,
      mockAuthManager(),
      handler,
    );

    engine.importArchive();

    // First clip should succeed
    const result1 = await engine.processNextClip();
    expect(result1).toBe(true);

    // Second should be blocked by quota
    const result2 = await engine.processNextClip();
    expect(result2).toBe(false);

    expect(events.some((e) => e.type === "quota:exhausted")).toBe(true);
  });

  it("skips clips with missing MP4 files", async () => {
    writeDump([{ clip_id: "no-file", created_at: "2022-01-01T00:00:00Z" }]);
    // Don't create the MP4 file

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();
    await engine.processNextClip();

    const stats = clipsRepo.getStats();
    expect(stats.skipped).toBe(1);
  });

  it("skips clips with MP4 files under 1KB", async () => {
    writeDump([{ clip_id: "tiny", created_at: "2022-01-01T00:00:00Z" }]);
    createClipFile("tiny", 500); // 500 bytes

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();
    await engine.processNextClip();

    const stats = clipsRepo.getStats();
    expect(stats.skipped).toBe(1);
  });

  it("resets uploading clips to pending on import", async () => {
    setup([{ clip_id: "stuck", created_at: "2022-01-01T00:00:00Z" }]);

    const clipsRepo = createClipsRepository(db);

    // Manually insert and mark as uploading (simulating a crash)
    clipsRepo.upsertFromArchive([
      {
        clipId: "stuck",
        url: "https://twitch.tv/test/clip/stuck",
        embedUrl: "https://clips.twitch.tv/embed?clip=stuck",
        broadcasterId: 12345,
        broadcasterName: "test",
        creatorId: 67890,
        creatorName: "viewer",
        gameId: null,
        language: "en",
        title: "Stuck clip",
        viewCount: 0,
        createdAt: "2022-01-01T00:00:00Z",
        thumbnailUrl: "https://example.com/thumb.jpg",
        clipArchived: true,
        thumbnailArchived: true,
        deletedOnTwitch: false,
      },
    ]);
    clipsRepo.markUploading("stuck");

    // Verify it's stuck
    expect(clipsRepo.getStats().uploading).toBe(1);

    // resetInterrupted is called by engine.start(), test the method directly
    clipsRepo.resetInterrupted();

    expect(clipsRepo.getStats().uploading).toBe(0);
    expect(clipsRepo.getStats().pending).toBe(1);
  });

  it("returns false when no clips to process", async () => {
    // Empty archive
    writeDump([]);

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();
    const result = await engine.processNextClip();
    expect(result).toBe(false);
  });

  it("does not process clips when paused", async () => {
    setup([{ clip_id: "clip-1", created_at: "2022-01-01T00:00:00Z" }]);

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();
    engine.pause();

    const result = await engine.processNextClip();
    expect(result).toBe(false);
    expect(clipsRepo.getStats().pending).toBe(1);
    expect(clipsRepo.getStats().uploaded).toBe(0);
  });

  it("resumes processing after pause", async () => {
    setup([{ clip_id: "clip-1", created_at: "2022-01-01T00:00:00Z" }]);

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();

    // Pause, verify no processing
    engine.pause();
    expect(engine.isPaused()).toBe(true);
    const paused = await engine.processNextClip();
    expect(paused).toBe(false);

    // Resume, verify processing works
    engine.resume();
    expect(engine.isPaused()).toBe(false);
    const resumed = await engine.processNextClip();
    expect(resumed).toBe(true);
    expect(clipsRepo.getStats().uploaded).toBe(1);
  });

  it("tracks current upload clip id", async () => {
    setup([{ clip_id: "clip-1", created_at: "2022-01-01T00:00:00Z" }]);

    const config = makeConfig();
    const clipsRepo = createClipsRepository(db);
    const uploadsRepo = createUploadsRepository(db);
    const quotaRepo = createQuotaRepository(db);
    const scheduler = createScheduler(quotaRepo, 10000, 100);

    const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, mockAuthManager());

    engine.importArchive();

    // Before upload
    expect(engine.getCurrentUpload()).toBeNull();

    // After upload completes
    await engine.processNextClip();
    expect(engine.getCurrentUpload()).toBeNull();
  });
});
