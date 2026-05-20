import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod/v4";

import { createLogger } from "#server/logger.js";

import { type DjangoClipFields, DjangoClipFieldsSchema, type TwitchClip } from "./types.js";

const LooseDumpEntrySchema = z.object({
  model: z.string(),
  fields: z.record(z.string(), z.unknown()),
});

const logger = createLogger("archive-reader");

export interface ReadLatestDumpOptions {
  /**
   * If set, falls back to the legacy "minimum file age" heuristic instead of
   * requiring a `.done` marker file. Use only when the upstream writer can't
   * be modified to emit markers.
   */
  legacyMinAgeMs?: number;
}

/**
 * Read the latest archive dump and return parsed clips.
 *
 * Default contract: the upstream writer is expected to atomically place a
 * sibling `<dump>.done` marker file alongside each dump once writing completes.
 * The reader picks up the newest dump that has a marker; dumps without a marker
 * are assumed to be mid-write and skipped.
 *
 * Legacy fallback: pass `{ legacyMinAgeMs }` to read the newest dump older than
 * that many ms instead. Use for installations whose upstream writer hasn't
 * been updated to emit markers yet.
 *
 * @param archivePath - Path to the archive root (contains db/ and media/)
 * @param options - See `ReadLatestDumpOptions`.
 */
export function readLatestDump(
  archivePath: string,
  options: ReadLatestDumpOptions = {},
): TwitchClip[] {
  const dbDir = resolve(archivePath, "db");

  let files: string[];
  try {
    files = readdirSync(dbDir).filter((f) => f.startsWith("dump_") && f.endsWith(".json"));
  } catch (error) {
    logger.error({ dbDir, error }, "Failed to read archive db directory");
    return [];
  }

  if (files.length === 0) {
    logger.warn({ dbDir }, "No dump files found");
    return [];
  }

  // Sort lexicographically (timestamp format ensures correct ordering)
  files.sort();

  const latestFile =
    options.legacyMinAgeMs !== undefined
      ? pickByAge(dbDir, files, options.legacyMinAgeMs)
      : pickByMarker(dbDir, files);

  if (!latestFile) {
    return [];
  }

  logger.info({ file: latestFile }, "Reading archive dump");
  return parseDumpFile(latestFile);
}

/** Newest dump that has a sibling `<file>.done` marker. */
function pickByMarker(dbDir: string, files: string[]): string | null {
  for (let i = files.length - 1; i >= 0; i--) {
    const filePath = resolve(dbDir, files[i]);
    if (existsSync(`${filePath}.done`)) {
      return filePath;
    }
  }
  logger.warn(
    { dbDir, fileCount: files.length },
    "No dump files have a .done marker; skipping (writer mid-flight, or marker convention not yet in use — set READER_LEGACY_FRESHNESS_MS to fall back to age-based selection)",
  );
  return null;
}

/** Newest dump older than `minAgeMs`. Legacy fallback for writers that don't emit markers. */
function pickByAge(dbDir: string, files: string[], minAgeMs: number): string | null {
  const now = Date.now();
  for (let i = files.length - 1; i >= 0; i--) {
    const filePath = resolve(dbDir, files[i]);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs >= minAgeMs) {
      return filePath;
    }
  }
  logger.warn({ fileCount: files.length, minAgeMs }, "All dump files too recent, skipping");
  return null;
}

export function parseDumpFile(filePath: string): TwitchClip[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    logger.error({ filePath, error }, "Failed to read dump file");
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error({ filePath, error }, "Failed to parse dump file as JSON");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.error({ filePath }, "Dump file is not an array");
    return [];
  }

  const clips: TwitchClip[] = [];
  let skipped = 0;
  let firstError: string | null = null;

  for (const raw of parsed) {
    const entry = LooseDumpEntrySchema.safeParse(raw);
    if (!entry.success) continue;
    if (entry.data.model !== "clips.clip") continue;

    const fieldsResult = DjangoClipFieldsSchema.safeParse(entry.data.fields);
    if (!fieldsResult.success) {
      skipped++;
      firstError ??= fieldsResult.error.message;
      continue;
    }

    clips.push(mapFieldsToClip(fieldsResult.data));
  }

  if (skipped > 0) {
    logger.warn({ skipped, firstError }, "Some clip entries failed field validation");
  }

  logger.info({ total: parsed.length, clips: clips.length, skipped }, "Parsed dump file");
  return clips;
}

function mapFieldsToClip(f: DjangoClipFields): TwitchClip {
  return {
    clipId: f.clip_id,
    url: f.url,
    embedUrl: f.embed_url,
    broadcasterId: f.broadcaster_id,
    broadcasterName: f.broadcaster_name,
    creatorId: f.creator_id,
    creatorName: f.creator_name,
    gameId: f.game_id ?? null,
    language: f.language,
    title: f.title,
    viewCount: f.view_count,
    createdAt: f.created_at,
    thumbnailUrl: f.thumbnail_url,
    clipArchived: f.clip_archived,
    thumbnailArchived: f.thumbnail_archived,
    deletedOnTwitch: f.deleted_on_twitch,
  };
}
