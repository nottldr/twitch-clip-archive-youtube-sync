import type Database from "better-sqlite3";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "#server/db/connection.js";
import { createEngineLogRepository } from "#server/db/repositories/engine-log.js";

let db: Database.Database;
let repo: ReturnType<typeof createEngineLogRepository>;

beforeEach(() => {
  db = createTestDb();
  repo = createEngineLogRepository(db);
});

afterEach(() => {
  db.close();
});

function seedLogs() {
  repo.insert({
    type: "state_change",
    fromState: "stopped",
    toState: "starting.importingArchive",
    message: "stopped → starting.importingArchive",
  });
  repo.insert({ type: "upload", clipId: "clip-a", youtubeId: "yt-a", message: "Uploaded clip-a" });
  repo.insert({
    type: "upload",
    clipId: "clip-b",
    error: "SERVER_ERROR: boom",
    message: "Upload failed for clip-b: SERVER_ERROR",
  });
  repo.insert({
    type: "upload",
    clipId: "clip-a",
    error: "RATE_LIMITED: too fast",
    message: "Upload failed for clip-a: RATE_LIMITED",
  });
  repo.insert({ type: "error", error: "auth refresh failed", message: "Auth refresh failed" });
}

describe("engineLog.query — clipId filter", () => {
  it("returns only rows for the requested clip", () => {
    seedLogs();
    const { entries } = repo.query({ clipId: "clip-a" });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.clip_id === "clip-a")).toBe(true);
  });

  it("composes with type filter", () => {
    seedLogs();
    const { entries } = repo.query({ clipId: "clip-a", types: ["upload"] });
    expect(entries).toHaveLength(2);
  });

  it("returns empty for a clip with no log rows", () => {
    seedLogs();
    expect(repo.query({ clipId: "missing" }).entries).toEqual([]);
  });
});

describe("engineLog.query — errorCode filter", () => {
  it("matches the prefix of the error column", () => {
    seedLogs();
    const { entries } = repo.query({ errorCode: "SERVER_ERROR" });
    expect(entries).toHaveLength(1);
    expect(entries[0].clip_id).toBe("clip-b");
  });

  it("composes with clipId filter", () => {
    seedLogs();
    const { entries } = repo.query({ clipId: "clip-a", errorCode: "RATE_LIMITED" });
    expect(entries).toHaveLength(1);
    expect(entries[0].clip_id).toBe("clip-a");
  });
});

describe("engineLog.query — since/until filters", () => {
  it("respects an ISO timestamp lower bound (since)", () => {
    // Insert a row, sleep slightly, then insert another. SQLite's datetime('now')
    // is second-precision, so we need at least a 1s gap to differentiate.
    repo.insert({ type: "error", error: "first", message: "first" });
    // Manually backdate one row so we don't have to sleep
    db.prepare("UPDATE engine_log SET timestamp = ? WHERE id = 1").run("2026-04-01T00:00:00");
    repo.insert({ type: "error", error: "second", message: "second" });
    db.prepare("UPDATE engine_log SET timestamp = ? WHERE id = 2").run("2026-05-01T00:00:00");

    const since = repo.query({ since: "2026-04-15T00:00:00" });
    expect(since.entries.map((e) => e.error)).toEqual(["second"]);

    const until = repo.query({ until: "2026-04-15T00:00:00" });
    expect(until.entries.map((e) => e.error)).toEqual(["first"]);

    const both = repo.query({ since: "2026-03-15T00:00:00", until: "2026-04-15T00:00:00" });
    expect(both.entries.map((e) => e.error)).toEqual(["first"]);
  });
});

describe("engineLog.query — existing filters still work", () => {
  it("type filter still functions on its own", () => {
    seedLogs();
    expect(repo.query({ types: ["upload"] }).entries).toHaveLength(3);
    expect(repo.query({ types: ["state_change"] }).entries).toHaveLength(1);
  });

  it("beforeId paginates correctly", () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ type: "state_change", message: `m${i}` });
    }
    const first = repo.query({ limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const next = repo.query({ limit: 2, beforeId: first.entries[1].id });
    expect(next.entries.every((e) => e.id < first.entries[1].id)).toBe(true);
  });
});
