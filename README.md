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

See [.env.example](./.env.example) for all available variables. The key ones for production:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: OAuth credentials
- `OAUTH_REDIRECT_BASE`: public origin for the OAuth redirect (e.g. `https://sync.example.com`)
- `DESCRIPTION_TEMPLATE`: customise the YouTube video description (see .env.example for available variables)
- `ADMIN_PASSWORD`: if set, protects the admin UI with HTTP basic auth
