import type Database from "better-sqlite3";

import { z } from "zod/v4";

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE clips (
          clip_id             TEXT PRIMARY KEY,
          title               TEXT NOT NULL,
          url                 TEXT NOT NULL,
          embed_url           TEXT NOT NULL,
          broadcaster_id      INTEGER NOT NULL,
          broadcaster_name    TEXT NOT NULL,
          creator_id          INTEGER NOT NULL,
          creator_name        TEXT NOT NULL,
          game_id             INTEGER,
          language            TEXT,
          view_count          INTEGER NOT NULL DEFAULT 0,
          created_at          TEXT NOT NULL,
          thumbnail_url       TEXT,
          clip_archived       INTEGER NOT NULL DEFAULT 0,
          thumbnail_archived  INTEGER NOT NULL DEFAULT 0,
          deleted_on_twitch   INTEGER NOT NULL DEFAULT 0,

          sync_status         TEXT NOT NULL DEFAULT 'pending'
                              CHECK(sync_status IN ('pending', 'uploading', 'uploaded', 'failed', 'skipped')),
          youtube_id          TEXT,
          uploaded_at         TEXT,
          last_error          TEXT,
          retry_count         INTEGER NOT NULL DEFAULT 0,

          first_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_clips_sync_status ON clips(sync_status);
      CREATE INDEX idx_clips_created_at ON clips(created_at);
      CREATE INDEX idx_clips_youtube_id ON clips(youtube_id);

      CREATE TABLE upload_attempts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          clip_id         TEXT NOT NULL REFERENCES clips(clip_id),
          started_at      TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at    TEXT,
          success         INTEGER NOT NULL DEFAULT 0,
          youtube_id      TEXT,
          error_message   TEXT,
          error_code      TEXT,
          quota_cost      INTEGER NOT NULL DEFAULT 100
      );

      CREATE INDEX idx_upload_attempts_clip_id ON upload_attempts(clip_id);
      CREATE INDEX idx_upload_attempts_started_at ON upload_attempts(started_at);

      CREATE TABLE quota_usage (
          date_pt         TEXT PRIMARY KEY,
          units_used      INTEGER NOT NULL DEFAULT 0,
          uploads_count   INTEGER NOT NULL DEFAULT 0,
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE oauth_tokens (
          id              INTEGER PRIMARY KEY CHECK (id = 1),
          access_token    TEXT NOT NULL,
          refresh_token   TEXT NOT NULL,
          expiry_date     TEXT NOT NULL,
          scope           TEXT NOT NULL,
          token_type      TEXT NOT NULL DEFAULT 'Bearer',
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

    `,
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists (bootstrapping)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const VersionSchema = z.object({ v: z.number().nullable() });
  const currentVersion = VersionSchema.parse(
    db.prepare("SELECT MAX(version) as v FROM schema_version").get(),
  );
  const version = currentVersion.v ?? 0;

  for (const migration of migrations) {
    if (migration.version > version) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
      })();
    }
  }
}
