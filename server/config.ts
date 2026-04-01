import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { SyncModeSchema } from "#shared/schemas.js";
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

  return {
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    oauthRedirectBase: required("OAUTH_REDIRECT_BASE"),
    archivePath,
    dataPath,
    port: optionalInt("PORT", 3000),
    dailyQuotaLimit: optionalInt("DAILY_QUOTA_LIMIT", 10000),
    uploadCost: optionalInt("UPLOAD_COST", 100),
    uploadIntervalMs: optionalInt("UPLOAD_INTERVAL_MS", 10000),
    archivePollIntervalMs: optionalInt("ARCHIVE_POLL_INTERVAL_MS", 900000),
    maxRetryCount: optionalInt("MAX_RETRY_COUNT", 3),
    logLevel: optional("LOG_LEVEL", "info"),
    dryRun: optionalBool("DRY_RUN", false),
    syncMode: SyncModeSchema.catch("auto").parse(process.env["SYNC_MODE"]),
    googleProjectNumber: process.env["GOOGLE_PROJECT_NUMBER"] ?? null,
    descriptionTemplate: process.env["DESCRIPTION_TEMPLATE"]?.replaceAll("\\n", "\n") ?? null,
    adminPassword: process.env["ADMIN_PASSWORD"] ?? null,
    webhookUrl: process.env["WEBHOOK_URL"] ?? null,
    webhookEvents: optional("WEBHOOK_EVENTS", "upload:success,quota:exhausted")
      .split(",")
      .map((s) => s.trim()),
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
