import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

loadDotenv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid integer for ${name}: ${value}`);
  }
  return parsed;
}

function optionalIntOrUndefined(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid integer for ${name}: ${value}`);
  }
  return parsed;
}

function optionalBool(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value === "true" || value === "1";
}

export function loadConfig() {
  const archivePath = resolve(optional("ARCHIVE_PATH", "./fixtures/archive"));
  const dataPath = resolve(optional("DATA_PATH", "./data"));

  // Validate archive path
  if (!existsSync(archivePath)) {
    throw new Error(`ARCHIVE_PATH does not exist: ${archivePath}`);
  }
  if (!existsSync(resolve(archivePath, "db"))) {
    throw new Error(`ARCHIVE_PATH missing db/ directory: ${archivePath}`);
  }
  if (!existsSync(resolve(archivePath, "media/clips"))) {
    throw new Error(`ARCHIVE_PATH missing media/clips/ directory: ${archivePath}`);
  }

  const dryRun = optionalBool("DRY_RUN", false);

  return {
    googleClientId: dryRun ? optional("GOOGLE_CLIENT_ID", "") : required("GOOGLE_CLIENT_ID"),
    googleClientSecret: dryRun
      ? optional("GOOGLE_CLIENT_SECRET", "")
      : required("GOOGLE_CLIENT_SECRET"),
    oauthRedirectBase: dryRun
      ? optional("OAUTH_REDIRECT_BASE", `http://localhost:${optionalInt("PORT", 3000)}`)
      : required("OAUTH_REDIRECT_BASE"),
    archivePath,
    dataPath,
    port: optionalInt("PORT", 3000),
    dailyQuotaLimit: optionalInt("DAILY_QUOTA_LIMIT", 10000),
    uploadCost: optionalInt("UPLOAD_COST", 100),
    uploadIntervalMs: optionalInt("UPLOAD_INTERVAL_MS", 10000),
    archivePollIntervalMs: optionalInt("ARCHIVE_POLL_INTERVAL_MS", 900000),
    /**
     * Optional fallback for archive readers whose upstream writer doesn't yet
     * emit a `.done` marker file alongside each dump. When set, the reader
     * picks the newest dump older than this many ms instead of requiring a
     * marker. Leave unset (the default) once the upstream writer has been
     * updated.
     */
    readerLegacyFreshnessMs: optionalIntOrUndefined("READER_LEGACY_FRESHNESS_MS"),
    maxRetryCount: optionalInt("MAX_RETRY_COUNT", 3),
    logLevel: optional("LOG_LEVEL", "info"),
    dryRun,
    googleProjectNumber: process.env["GOOGLE_PROJECT_NUMBER"] ?? null,
    descriptionTemplate: process.env["DESCRIPTION_TEMPLATE"]?.replaceAll("\\n", "\n") ?? null,
    adminPassword: process.env["ADMIN_PASSWORD"] ?? null,
    webhookUrl: process.env["WEBHOOK_URL"] ?? null,
    ignoredClipIds: optional("IGNORED_CLIP_IDS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webhookEvents: optional("WEBHOOK_EVENTS", "upload:success,quota:exhausted")
      .split(",")
      .map((s) => s.trim()),
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
