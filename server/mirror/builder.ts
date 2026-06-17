import { Temporal } from "@js-temporal/polyfill";
import { stringify as stableStringify } from "safe-stable-stringify";

import type { ClipRow, ClipsRepository, SyncStatus } from "#server/db/repositories/clips.js";

const SCHEMA_VERSION = 1;

/**
 * Trimmed clip shape published to the mirror. Drops internal IDs, operational
 * flags, and error / retry surface — keep only what's meaningful to outside
 * consumers (a friend's indexer, a public archive site). Key order here is
 * irrelevant: `safe-stable-stringify` sorts alphabetically on serialize, so
 * byte output is invariant to construction order and to future column
 * additions / removals.
 */
function toPublicRow(clip: ClipRow) {
  return {
    broadcaster_name: clip.broadcaster_name,
    clip_id: clip.clip_id,
    created_at: clip.created_at,
    creator_name: clip.creator_name,
    deleted_on_twitch: clip.deleted_on_twitch,
    game_id: clip.game_id,
    language: clip.language,
    sync_status: clip.sync_status,
    thumbnail_url: clip.thumbnail_url,
    title: clip.title,
    uploaded_at: clip.uploaded_at,
    url: clip.url,
    view_count: clip.view_count,
    youtube_id: clip.youtube_id,
  };
}

export type Manifest = {
  schema_version: number;
  generated_at: string;
  clip_count: number;
  by_status: Record<SyncStatus, number>;
};

export interface Snapshot {
  clipsJson: string;
  manifestJson: string;
  manifest: Manifest;
}

/**
 * Build the two files that get pushed to the mirror repo: `clips.json`
 * (pretty-printed, alphabetically-keyed, sorted by `created_at, clip_id`)
 * and `manifest.json` (small metadata blob). Pure function over the repo —
 * easy to snapshot-test for byte stability.
 */
export function buildSnapshot(clipsRepo: ClipsRepository): Snapshot {
  const rows = clipsRepo.allForMirror();
  const publicRows = rows.map((r) => toPublicRow(r));
  const clipsJson = stableStringify(publicRows, undefined, 2) ?? "[]";

  const byStatus: Record<SyncStatus, number> = {
    pending: 0,
    uploading: 0,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    ignored: 0,
  };
  for (const row of rows) {
    byStatus[row.sync_status]++;
  }

  const manifest: Manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: Temporal.Now.instant().toString(),
    clip_count: rows.length,
    by_status: byStatus,
  };
  const manifestJson = stableStringify(manifest, undefined, 2) ?? "{}";

  return { clipsJson, manifestJson, manifest };
}
