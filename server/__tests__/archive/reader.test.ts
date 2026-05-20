import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseDumpFile, readLatestDump } from "#server/archive/reader.js";

let tmpDir: string;
let dbDir: string;

function writeDump(filename: string, content: unknown, ageMs: number = 120_000) {
  const filePath = resolve(dbDir, filename);
  writeFileSync(filePath, JSON.stringify(content));
  // Set mtime to ageMs ago so it passes the freshness check
  const mtime = new Date(Date.now() - ageMs);
  utimesSync(filePath, mtime, mtime);
}

const validClipEntry = {
  model: "clips.clip",
  pk: 1,
  fields: {
    clip_id: "TestClip-abc123",
    url: "https://www.twitch.tv/georgy177/clip/TestClip-abc123",
    embed_url: "https://clips.twitch.tv/embed?clip=TestClip-abc123",
    broadcaster_id: 135075027,
    broadcaster_name: "georgy177",
    creator_id: 100001,
    creator_name: "viewer_one",
    game_id: 509658,
    language: "nl",
    title: "Amazing play",
    view_count: 150,
    created_at: "2022-04-14T18:50:58Z",
    thumbnail_url: "https://example.com/thumb.jpg",
    clip_archived: true,
    thumbnail_archived: true,
    deleted_on_twitch: false,
  },
};

const secondClipEntry = {
  model: "clips.clip",
  pk: 2,
  fields: {
    ...validClipEntry.fields,
    clip_id: "TestClip-def456",
    url: "https://www.twitch.tv/georgy177/clip/TestClip-def456",
    embed_url: "https://clips.twitch.tv/embed?clip=TestClip-def456",
    title: "Second clip",
    created_at: "2023-01-01T00:00:00Z",
  },
};

beforeEach(() => {
  const id = randomUUID().slice(0, 8);
  tmpDir = resolve(import.meta.dirname, `../../__tests__/.tmp-archive-${id}`);
  dbDir = resolve(tmpDir, "db");
  mkdirSync(dbDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeMarker(dumpFilename: string) {
  writeFileSync(resolve(dbDir, `${dumpFilename}.done`), "");
}

describe("readLatestDump (default: .done marker mode)", () => {
  it("picks the latest dump that has a .done marker", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry]);
    writeMarker("dump_2026-01-01_00_00_00.json");
    writeDump("dump_2026-02-01_00_00_00.json", [secondClipEntry]);
    writeMarker("dump_2026-02-01_00_00_00.json");

    const clips = readLatestDump(tmpDir);
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-def456");
  });

  it("skips a dump that has no .done marker (assumed mid-write)", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry]);
    // no marker
    const clips = readLatestDump(tmpDir);
    expect(clips).toEqual([]);
  });

  it("falls back to the latest dump that does have a marker", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry]);
    writeMarker("dump_2026-01-01_00_00_00.json");
    writeDump("dump_2026-02-01_00_00_00.json", [secondClipEntry]);
    // no marker on the newer one

    const clips = readLatestDump(tmpDir);
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-abc123");
  });

  it("returns empty array if db directory does not exist", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    const clips = readLatestDump(tmpDir);
    expect(clips).toEqual([]);
  });

  it("returns empty array if no dump files exist", () => {
    const clips = readLatestDump(tmpDir);
    expect(clips).toEqual([]);
  });
});

describe("readLatestDump (legacy: minAgeMs freshness heuristic)", () => {
  it("picks the latest dump file by filename", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry]);
    writeDump("dump_2026-02-01_00_00_00.json", [secondClipEntry]);

    const clips = readLatestDump(tmpDir, { legacyMinAgeMs: 0 });
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-def456");
  });

  it("skips files modified less than minAgeMs ago", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry], 0);

    const clips = readLatestDump(tmpDir, { legacyMinAgeMs: 60_000 });
    expect(clips).toHaveLength(0);
  });

  it("falls back to older file if latest is too fresh", () => {
    writeDump("dump_2026-01-01_00_00_00.json", [validClipEntry], 120_000);
    writeDump("dump_2026-02-01_00_00_00.json", [secondClipEntry], 0);

    const clips = readLatestDump(tmpDir, { legacyMinAgeMs: 60_000 });
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-abc123");
  });
});

describe("parseDumpFile", () => {
  it("filters entries by model === clips.clip", () => {
    const nonClipEntry = { model: "auth.user", pk: 1, fields: { username: "admin" } };
    writeDump("dump.json", [validClipEntry, nonClipEntry]);

    const clips = parseDumpFile(resolve(dbDir, "dump.json"));
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-abc123");
  });

  it("maps all fields correctly", () => {
    writeDump("dump.json", [validClipEntry]);
    const clips = parseDumpFile(resolve(dbDir, "dump.json"));
    const clip = clips[0];

    expect(clip.clipId).toBe("TestClip-abc123");
    expect(clip.url).toBe("https://www.twitch.tv/georgy177/clip/TestClip-abc123");
    expect(clip.embedUrl).toBe("https://clips.twitch.tv/embed?clip=TestClip-abc123");
    expect(clip.broadcasterId).toBe(135075027);
    expect(clip.broadcasterName).toBe("georgy177");
    expect(clip.creatorId).toBe(100001);
    expect(clip.creatorName).toBe("viewer_one");
    expect(clip.gameId).toBe(509658);
    expect(clip.language).toBe("nl");
    expect(clip.title).toBe("Amazing play");
    expect(clip.viewCount).toBe(150);
    expect(clip.createdAt).toBe("2022-04-14T18:50:58Z");
    expect(clip.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(clip.clipArchived).toBe(true);
    expect(clip.thumbnailArchived).toBe(true);
    expect(clip.deletedOnTwitch).toBe(false);
  });

  it("handles null game_id", () => {
    const entry = {
      ...validClipEntry,
      fields: { ...validClipEntry.fields, game_id: null },
    };
    writeDump("dump.json", [entry]);
    const clips = parseDumpFile(resolve(dbDir, "dump.json"));
    expect(clips[0].gameId).toBeNull();
  });

  it("returns empty array for malformed JSON", () => {
    writeFileSync(resolve(dbDir, "dump.json"), "not json{{{");
    const clips = parseDumpFile(resolve(dbDir, "dump.json"));
    expect(clips).toEqual([]);
  });

  it("returns empty array for non-existent file", () => {
    const clips = parseDumpFile(resolve(dbDir, "nope.json"));
    expect(clips).toEqual([]);
  });

  it("skips clip entries that fail field validation", () => {
    const badEntry = {
      model: "clips.clip",
      pk: 99,
      fields: { clip_id: "bad", title: "missing fields" }, // incomplete
    };
    writeDump("dump.json", [validClipEntry, badEntry]);
    const clips = parseDumpFile(resolve(dbDir, "dump.json"));
    expect(clips).toHaveLength(1);
    expect(clips[0].clipId).toBe("TestClip-abc123");
  });
});
