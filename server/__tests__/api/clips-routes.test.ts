import type Database from "better-sqlite3";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "#server/api/app.js";
import { createSSEManager } from "#server/api/sse.js";
import type { Config } from "#server/config.js";
import { createTestDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createEngineLogRepository } from "#server/db/repositories/engine-log.js";
import { createEngineStateRepository } from "#server/db/repositories/engine-state.js";
import { createMirrorPublishesRepository } from "#server/db/repositories/mirror-publishes.js";
import { createOAuthRepository } from "#server/db/repositories/oauth.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createUploadsRepository } from "#server/db/repositories/uploads.js";
import { createSyncEngine } from "#server/sync/engine.js";
import { createScheduler } from "#server/sync/scheduler.js";

let db: Database.Database;
let tmpDir: string;
let app: ReturnType<typeof createApp>;
let clipsRepo: ReturnType<typeof createClipsRepository>;
let uploadsRepo: ReturnType<typeof createUploadsRepository>;
let logRepo: ReturnType<typeof createEngineLogRepository>;

function mockAuthManager() {
  return {
    getAuthUrl: () => "https://example.com/auth",
    exchangeCode: async (_code: string, _state: string) => {},
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
    getAuthenticatedClient: async () => ({}) as never,
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
    getOAuth2Client: async () => ({}) as never,
    isAuthenticated: () => true,
    revokeTokens: () => {},
  };
}

function makeConfig(): Config {
  return {
    googleClientId: "",
    googleClientSecret: "",
    oauthRedirectBase: "http://localhost:3000",
    archivePath: resolve(tmpDir, "archive"),
    dataPath: resolve(tmpDir, "data"),
    port: 3000,
    dailyQuotaLimit: 10_000,
    uploadCost: 100,
    uploadIntervalMs: 10_000,
    archivePollIntervalMs: 999_999,
    readerLegacyFreshnessMs: undefined,
    maxRetryCount: 3,
    logLevel: "fatal",
    dryRun: true,
    googleProjectNumber: null,
    descriptionTemplate: null,
    adminPassword: null,
    webhookUrl: null,
    ignoredClipIds: [],
    webhookEvents: [],
    mirrorGithubToken: null,
    mirrorRepoOwner: null,
    mirrorRepoName: null,
    mirrorBranch: "main",
  };
}

function seedClip(clipId: string, title: string = `Title ${clipId}`) {
  clipsRepo.upsertFromArchive([
    {
      clipId,
      url: `https://twitch.tv/${clipId}`,
      embedUrl: `https://clips.twitch.tv/${clipId}`,
      broadcasterId: 1,
      broadcasterName: "broad",
      creatorId: 2,
      creatorName: "creator",
      gameId: null,
      language: "en",
      title,
      viewCount: 100,
      createdAt: "2026-01-01T00:00:00Z",
      thumbnailUrl: "t",
      clipArchived: true,
      thumbnailArchived: true,
      deletedOnTwitch: false,
    },
  ]);
}

beforeEach(() => {
  tmpDir = resolve(import.meta.dirname, `../../__tests__/.tmp-clip-routes-${Date.now()}`);
  mkdirSync(resolve(tmpDir, "archive/db"), { recursive: true });
  mkdirSync(resolve(tmpDir, "archive/media/clips"), { recursive: true });
  mkdirSync(resolve(tmpDir, "data"), { recursive: true });

  db = createTestDb();
  clipsRepo = createClipsRepository(db);
  logRepo = createEngineLogRepository(db);
  uploadsRepo = createUploadsRepository(db, logRepo);
  const quotaRepo = createQuotaRepository(db);
  const engineStateRepo = createEngineStateRepository(db);
  const oauthRepo = createOAuthRepository(db);
  const scheduler = createScheduler(quotaRepo, 10_000, 100);
  const auth = mockAuthManager();
  const sseManager = createSSEManager();
  const config = makeConfig();
  const engine = createSyncEngine(config, clipsRepo, uploadsRepo, scheduler, auth, engineStateRepo);

  const mirrorRepo = createMirrorPublishesRepository(db);
  app = createApp(
    config,
    clipsRepo,
    uploadsRepo,
    scheduler,
    engine,
    auth,
    sseManager,
    logRepo,
    oauthRepo,
    mirrorRepo,
    null,
  );
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await app.fetch(new Request(`http://test${path}`, init));
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, body };
}

describe("GET /api/clips/:clipId", () => {
  it("returns the clip + recent attempts + recent log rows", async () => {
    seedClip("clip-a");
    const a = uploadsRepo.logAttempt("clip-a", 100);
    uploadsRepo.recordSuccess({
      clipId: "clip-a",
      attemptId: a,
      youtubeId: "yt-a",
      quotaCost: 100,
      datePt: "2026-05-21",
    });

    const { status, body } = await fetchJson("/api/clips/clip-a");
    expect(status).toBe(200);
    const json = body as {
      clip: { clip_id: string; sync_status: string };
      attempts: Array<{ id: number; success: number }>;
      logs: Array<{ type: string; clip_id: string | null }>;
    };
    expect(json.clip.clip_id).toBe("clip-a");
    expect(json.clip.sync_status).toBe("uploaded");
    expect(json.attempts).toHaveLength(1);
    expect(json.attempts[0].success).toBe(1);
    // The recordSuccess transaction also writes a type='upload' engine_log row.
    expect(json.logs.some((l) => l.clip_id === "clip-a" && l.type === "upload")).toBe(true);
  });

  it("returns 404 when the clip is missing", async () => {
    const { status, body } = await fetchJson("/api/clips/does-not-exist");
    expect(status).toBe(404);
    expect((body as { error: string }).error).toBe("Clip not found");
  });
});

describe("GET /api/clips/:clipId/attempts", () => {
  it("paginates", async () => {
    seedClip("clip-a");
    for (let i = 0; i < 3; i++) uploadsRepo.logAttempt("clip-a", 100);

    const { body } = await fetchJson("/api/clips/clip-a/attempts?limit=2");
    const json = body as { attempts: Array<{ id: number }>; hasMore: boolean };
    expect(json.attempts).toHaveLength(2);
    expect(json.hasMore).toBe(true);
  });
});

describe("POST /api/clips/:clipId/retry", () => {
  it("resets the clip and reports ok", async () => {
    seedClip("clip-a");
    clipsRepo.markFailed("clip-a", "stale error");

    const { status, body } = await fetchJson("/api/clips/clip-a/retry", { method: "POST" });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);

    const clip = clipsRepo.getById("clip-a");
    expect(clip?.sync_status).toBe("pending");
    expect(clip?.last_error).toBeNull();
    expect(clip?.retry_count).toBe(0);
  });

  it("returns 404 when the clip is missing or already pending", async () => {
    const { status } = await fetchJson("/api/clips/nope/retry", { method: "POST" });
    expect(status).toBe(404);
  });
});

describe("POST /api/clips/bulk", () => {
  beforeEach(() => {
    seedClip("a");
    seedClip("b");
    seedClip("c");
  });

  it("ignore — marks listed clips as ignored", async () => {
    const { status, body } = await fetchJson("/api/clips/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "ignore", clipIds: ["a", "b"] }),
    });
    expect(status).toBe(200);
    expect((body as { affected: number }).affected).toBe(2);
    expect(clipsRepo.getById("a")?.sync_status).toBe("ignored");
    expect(clipsRepo.getById("c")?.sync_status).toBe("pending");
  });

  it("rejects malformed request body with 400", async () => {
    const { status } = await fetchJson("/api/clips/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "explode", clipIds: ["a"] }),
    });
    expect(status).toBe(400);
  });

  it("rejects empty clipIds with 400", async () => {
    const { status } = await fetchJson("/api/clips/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "ignore", clipIds: [] }),
    });
    expect(status).toBe(400);
  });
});

describe("/api/logs query filters", () => {
  it("filters by clipId", async () => {
    seedClip("a");
    seedClip("b");
    const aA = uploadsRepo.logAttempt("a", 100);
    uploadsRepo.recordFailure({
      clipId: "a",
      attemptId: aA,
      errorMessage: "boom",
      errorCode: "SERVER_ERROR",
    });
    const aB = uploadsRepo.logAttempt("b", 100);
    uploadsRepo.recordFailure({
      clipId: "b",
      attemptId: aB,
      errorMessage: "kaboom",
      errorCode: "NETWORK_ERROR",
    });

    const { status, body } = await fetchJson("/api/logs?clipId=a");
    expect(status).toBe(200);
    const json = body as { entries: Array<{ clip_id: string; type: string }> };
    expect(json.entries.every((e) => e.clip_id === "a")).toBe(true);
  });

  it("filters by errorCode", async () => {
    seedClip("a");
    const aId = uploadsRepo.logAttempt("a", 100);
    uploadsRepo.recordFailure({
      clipId: "a",
      attemptId: aId,
      errorMessage: "boom",
      errorCode: "QUOTA_EXCEEDED",
    });
    const aId2 = uploadsRepo.logAttempt("a", 100);
    uploadsRepo.recordFailure({
      clipId: "a",
      attemptId: aId2,
      errorMessage: "kaboom",
      errorCode: "SERVER_ERROR",
    });

    const { body } = await fetchJson("/api/logs?errorCode=QUOTA_EXCEEDED");
    const json = body as { entries: Array<{ error: string | null }> };
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].error).toContain("QUOTA_EXCEEDED");
  });
});
