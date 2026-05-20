# twitch-clip-archive-youtube-sync

Uploads clips from a [twitch-clip-archive](https://github.com/seriousm4x/twitch-clip-archive) instance to YouTube as unlisted videos. Includes a web admin UI for monitoring progress, managing OAuth, and exporting YouTube links.

This tool reads the JSON database dumps and media files that twitch-clip-archive produces, uploads them to YouTube via the Data API v3, and tracks what's been synced in a local SQLite database. It respects YouTube's daily quota limits and picks up where it left off after restarts.

You'll need a running twitch-clip-archive instance with its `db/` and `media/` directories accessible (mounted read-only in Docker, or on disk for local dev).

## Prerequisites

- [mise](https://mise.jdx.dev/) for managing Node.js and pnpm versions
- A [twitch-clip-archive](https://github.com/seriousm4x/twitch-clip-archive) instance with clips already archived
- A Google Cloud project with YouTube Data API v3 enabled (see [Google Cloud Setup](#google-cloud-setup))

## Dev setup

```bash
mise install
pnpm install
cp .env.example .env
# Edit .env, at minimum set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
pnpm dev
```

The backend (Hono) runs on `http://localhost:3000` and the frontend (Vite) on `http://localhost:5173`, proxying API requests to the backend.

By default, `ARCHIVE_PATH` points to `./fixtures/archive` which contains a small set of sample clips for development. You don't need the full archive to develop locally.

### Dry run mode

Set `DRY_RUN=true` in your `.env` to run the sync engine without calling the YouTube API. It goes through the full flow (read archive, pick next clip, check quota) but generates fake YouTube IDs instead of uploading. Useful for testing the sync loop or developing the admin UI.

### Scripts

Check `package.json` for the full list, but the key scripts you'll want are:

| Script                   | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `pnpm dev`               | Start backend + frontend dev servers concurrently  |
| `pnpm dev:seed`          | Seed dev DB with mixed clip states + quota history |
| `pnpm build`             | Build frontend                                     |
| `pnpm test`              | Run tests                                          |
| `pnpm test:watch`        | Run tests in watch mode                            |
| `pnpm run ci`            | Run all checks (typecheck, lint, format, test)     |
| `pnpm fixtures:generate` | Regenerate fixture media files                     |

## Google Cloud setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or use an existing one).
2. Enable the YouTube Data API v3 (APIs & Services → Library).
3. Optionally enable the Service Usage API for automatic quota limit discovery.
4. Create OAuth 2.0 credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Add `http://localhost:3000/api/oauth/callback` as an authorised redirect URI (and your production URL if applicable)
5. Copy the Client ID and Client Secret into your `.env`.
6. Configure the consent screen (APIs & Services → OAuth consent screen) with scopes: `youtube.upload`, `youtube.readonly`, `cloud-platform.read-only`.

If your consent screen is in "Testing" mode, refresh tokens expire after 7 days. Publish the app so tokens persist indefinitely.

## Docker deployment

### Build locally

```bash
docker compose up --build
```

### Pull from GHCR

```bash
docker compose -f docker-compose.prod.yml up
```

The admin UI is available at `http://localhost:3000`. On first visit, click "Connect YouTube" to complete the OAuth flow.

### Volumes

| Mount                                      | Purpose                                       |
| ------------------------------------------ | --------------------------------------------- |
| `./data:/app/data`                         | SQLite database and OAuth tokens (persistent) |
| `/path/to/twitch-clip-archive:/archive:ro` | Clip archive (read-only)                      |

### Environment variables

See [.env.example](./.env.example) for all available variables. Key ones:

| Variable                                   | Default              | Purpose                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | _required_           | OAuth credentials for the YouTube Data API.                                                                                                                                                                                                               |
| `OAUTH_REDIRECT_BASE`                      | _required in prod_   | Public origin for the OAuth callback (e.g. `https://sync.example.com`).                                                                                                                                                                                   |
| `ARCHIVE_PATH`                             | `./fixtures/archive` | Path to the twitch-clip-archive root (contains `db/` and `media/clips/`).                                                                                                                                                                                 |
| `DATA_PATH`                                | `./data`             | Where the SQLite DB lives.                                                                                                                                                                                                                                |
| `PORT`                                     | `3000`               | HTTP listen port.                                                                                                                                                                                                                                         |
| `DAILY_QUOTA_LIMIT`                        | `10000`              | Daily quota fallback when Service Usage discovery is unavailable.                                                                                                                                                                                         |
| `UPLOAD_COST`                              | `100`                | Quota units per upload (YouTube's published cost is 1600; this is intentionally conservative for older keys — adjust if your project has a different cost).                                                                                               |
| `UPLOAD_INTERVAL_MS`                       | `10000`              | Cooldown between consecutive uploads.                                                                                                                                                                                                                     |
| `ARCHIVE_POLL_INTERVAL_MS`                 | `900000`             | How often to re-scan the archive dump (15 min by default).                                                                                                                                                                                                |
| `READER_LEGACY_FRESHNESS_MS`               | _unset_              | If set, the archive reader falls back to picking the newest dump older than this many ms instead of requiring a `.done` marker file. Use only when the upstream writer can't yet emit markers. See [Archive dump consumption](#archive-dump-consumption). |
| `MAX_RETRY_COUNT`                          | `3`                  | Times to retry a failed clip before parking it.                                                                                                                                                                                                           |
| `LOG_LEVEL`                                | `info`               | Pino log level (`trace`/`debug`/`info`/`warn`/`error`).                                                                                                                                                                                                   |
| `DRY_RUN`                                  | `false`              | Skip real YouTube calls; simulate uploads.                                                                                                                                                                                                                |
| `DESCRIPTION_TEMPLATE`                     | _unset_              | Custom YouTube description template (see `.env.example`).                                                                                                                                                                                                 |
| `ADMIN_PASSWORD`                           | _unset_              | If set, the admin UI is protected with HTTP basic auth (`admin` + this password).                                                                                                                                                                         |
| `GOOGLE_PROJECT_NUMBER`                    | _unset_              | Numeric Google Cloud project ID; if set, the engine queries Service Usage to discover the real daily quota at startup.                                                                                                                                    |
| `IGNORED_CLIP_IDS`                         | _unset_              | Comma-separated clip IDs to mark `ignored` (skipped permanently).                                                                                                                                                                                         |
| `WEBHOOK_URL`, `WEBHOOK_EVENTS`            | _unset_              | Outbound webhook delivery for selected events.                                                                                                                                                                                                            |

### Archive dump consumption

The reader expects an **atomic-write contract** with the upstream
twitch-clip-archive writer: each `dump_*.json` should be paired with a
sibling `dump_*.json.done` marker file once the JSON has been fully
written. The reader picks the newest dump that has a marker; dumps without
a marker are assumed to be mid-write and skipped.

If your upstream writer doesn't yet emit markers, set
`READER_LEGACY_FRESHNESS_MS=60000` to fall back to the prior heuristic
("ignore dumps modified less than 60s ago"). This is a transitional
escape hatch; teach the upstream writer to emit markers when you can.

## Operations

> Common procedures and recipes for running this in production. If you're
> adding new ops behaviour, document it here so future you (or a teammate)
> can find it without spelunking through commits.

### Pre-deploy ritual

Run through this before every container image swap:

1. **Snapshot the DB.** On the prod host:
   ```bash
   cp data/sync.db data/sync.db.bak.$(date +%Y%m%d-%H%M%S)
   ```
   Retain the last ~10 backups. The DB is small; storage is cheap relative
   to losing upload state.
2. **Stage the new image against a copy of the prod DB.** Pull the new
   image but don't replace the running container. Spin a sidecar against
   `data.bak/` with `DRY_RUN=true` for ~15 minutes. Watch:
   - `GET /health` returns `{ status: "ok", ... }`
   - `GET /api/engine/status` reaches an `active.*` state
   - Nothing alarming in container logs
3. **Verify migrations applied cleanly**:
   ```bash
   sqlite3 data/sync.db "SELECT MAX(version) FROM schema_version"
   ```
   Compare against the latest version in `server/db/migrations.ts`.
4. **For Zod-schema-tightening releases**, run this against prod first:
   ```bash
   sqlite3 data/sync.db "SELECT DISTINCT sync_status FROM clips"
   ```
   Every value must be in `{pending, uploading, uploaded, failed, skipped,
ignored}` (the CHECK constraint guarantees this; verify anyway).
5. **Deploy.** Restart the container. Watch `/api/engine/status` for one
   full upload cycle (a single clip uploads end-to-end). If anything
   looks wrong, roll back — see [Rollback](#rollback).

### Rollback

Each deploy is just a container image tag swap. To roll back:

```bash
# Switch the image tag back to the previous version in docker-compose,
# then:
docker compose up -d youtube-sync
```

Because no migration in this codebase is destructive (and all data lives
in the SQLite file on the host volume, not inside the image), the previous
image will boot cleanly against the post-migration DB — additive indexes
and unused-but-present columns are ignored.

Only restore from the SQL snapshot if data was corrupted in flight.

### Common operational tasks

#### Retry a single failed clip

`POST /api/clips/:clipId/reset` then `POST /api/engine/trigger/:clipId`
(planned: `POST /api/clips/:clipId/retry` will combine these into one).

#### Retry all failed clips

`POST /api/engine/reset-failed`. Sends `CLIPS_CHANGED` to the engine so
it'll start picking them up immediately if otherwise idle.

#### Mark a clip as ignored

For a single clip there's no API yet — set `IGNORED_CLIP_IDS=clip1,clip2`
in the environment and restart, OR mark via SQL:

```bash
sqlite3 data/sync.db "UPDATE clips SET sync_status='ignored' WHERE clip_id IN ('clip1','clip2')"
```

(A bulk-action API endpoint is planned.)

#### Reset everything (nuke and pave)

`POST /api/engine/reset-all`. Resets all non-`ignored` clips to `pending`,
clears `youtube_id`/`uploaded_at`/`last_error`/`retry_count`. Use with
caution: this will re-upload everything to YouTube. Snapshot the DB
first.

#### Recover when OAuth is lost

If the YouTube token is revoked (manually or via expiry), the engine
enters `active.blocked.awaitingAuth`. Visit the admin UI and click
"Connect YouTube" → the OAuth callback fires `notifyAuthComplete()` and
the engine transitions back to `active.*`.

If you suspect the token is in a weird state, you can hard-reset:

```bash
sqlite3 data/sync.db "DELETE FROM oauth_tokens WHERE id=1"
```

Then re-connect via the UI.

#### Debug a stuck upload

Check `GET /api/engine/status`:

- `active.uploading` for >10 min on the same clip → the upload is likely
  hung. Restart the container; `resetInterrupted` will recover correctly
  (preserves `youtube_id` if it was set, otherwise resets to `pending`).
- `active.waiting.quotaExhausted` → expected after hitting the daily cap;
  resolves on its own at midnight PT.
- `active.waiting.error` → check `GET /api/logs?types=error` for the
  most recent error.
- `active.blocked.awaitingAuth` → see [Recover when OAuth is lost](#recover-when-oauth-is-lost).

#### Investigate quota mismatch

If the UI's quota counter disagrees with what YouTube reports, check
local vs. recorded uploads:

```bash
sqlite3 data/sync.db <<'SQL'
SELECT date_pt, units_used, uploads_count FROM quota_usage ORDER BY date_pt DESC LIMIT 5;
SELECT COUNT(*) FROM upload_attempts WHERE success=1
  AND started_at >= date('now','-1 day');
SQL
```

The `quota_usage.uploads_count` for today should equal the count of
successful `upload_attempts` since the PT midnight. Mismatches after the
atomicity work (Phase 1.1) indicate either a YouTube-side discrepancy or
a row written outside the `recordSuccess` transaction — investigate the
upload_attempts table for orphan rows.

### Phase tracking

A short changelog of behaviour changes that aren't obvious from the code
or commit messages. Append as phases land.

- **Phase 1 (foundation):** Atomic `recordSuccess`/`recordFailure` for
  the upload write-set; safer `resetInterrupted` that promotes
  uploaded-but-not-marked rows instead of resetting; Zod schemas now
  enforce DB CHECK constraints; archive reader requires `.done` marker
  (or `READER_LEGACY_FRESHNESS_MS` fallback); single-flight OAuth token
  refresh.
