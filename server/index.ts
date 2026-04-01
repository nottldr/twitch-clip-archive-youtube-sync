import { serve } from "@hono/node-server";

import { createApp } from "#server/api/app.js";
import { createSSEManager } from "#server/api/sse.js";
import { loadConfig } from "#server/config.js";
import { closeDb, getDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createOAuthRepository } from "#server/db/repositories/oauth.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createUploadsRepository } from "#server/db/repositories/uploads.js";
import { createLogger } from "#server/logger.js";
import { type EngineEventHandler, createSyncEngine } from "#server/sync/engine.js";
import { discoverQuotaLimit } from "#server/sync/quota-discovery.js";
import { createScheduler } from "#server/sync/scheduler.js";
import { createAuthManager } from "#server/youtube/auth.js";

const config = loadConfig();
const logger = createLogger("server");

// Database
const db = getDb(config.dataPath);
const clipsRepo = createClipsRepository(db);
const uploadsRepo = createUploadsRepository(db);
const quotaRepo = createQuotaRepository(db);
const oauthRepo = createOAuthRepository(db);

// YouTube auth
const authManager = createAuthManager(config, oauthRepo);

// Scheduler
const scheduler = createScheduler(quotaRepo, config.dailyQuotaLimit, config.uploadCost);

// Quota discovery
async function refreshQuotaLimit() {
  if (!config.googleProjectNumber) return;
  const limit = await discoverQuotaLimit(authManager, config.googleProjectNumber);
  if (limit !== null) {
    scheduler.setDiscoveredLimit(limit);
    logger.info({ limit }, "Quota limit discovered from Google API");
  }
}

// SSE
const sseManager = createSSEManager();

// Engine event handler: logs + broadcasts via SSE
const eventHandler: EngineEventHandler = {
  onUploadSuccess(clipId, youtubeId) {
    logger.info({ clipId, youtubeId }, "Upload success");
    sseManager.broadcast("upload:success", { clipId, youtubeId });
  },
  onUploadFailure(clipId, error) {
    logger.warn({ clipId, error }, "Upload failure");
    sseManager.broadcast("upload:failure", { clipId, error });
  },
  onQuotaExhausted() {
    logger.info("Daily quota exhausted");
    sseManager.broadcast("quota:exhausted", {});
  },
  onSyncError(error) {
    logger.error({ error }, "Sync error");
    sseManager.broadcast("sync:error", { error });
  },
  onStatusChange(status) {
    logger.info({ status }, "Engine status changed");
    sseManager.broadcast("sync:status", { status });
  },
  onAuthComplete() {
    void refreshQuotaLimit();
  },
};

// Sync engine
const engine = createSyncEngine(
  config,
  clipsRepo,
  uploadsRepo,
  scheduler,
  authManager,
  eventHandler,
);

// Hono app
const app = createApp(config, clipsRepo, scheduler, engine, authManager, sseManager);

// Start server, wait for it to be listening before starting the engine
const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
  const s = serve({ fetch: app.fetch, port: config.port }, () => {
    logger.info({ port: config.port, dryRun: config.dryRun }, "Server started");
    resolve(s);
  });
  s.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error({ port: config.port }, "Port already in use");
    } else {
      logger.error({ error }, "Server error");
    }
    reject(error);
  });
});

// Start sync engine
logger.info({ archivePath: config.archivePath, dataPath: config.dataPath }, "Starting sync engine");
try {
  await engine.start();
  const stats = clipsRepo.getStats();
  logger.info(
    { total: stats.total, pending: stats.pending, uploaded: stats.uploaded },
    "Sync engine started",
  );
} catch (error) {
  logger.error({ error }, "Failed to start sync engine");
}

// Discover quota limit on startup and refresh daily
await refreshQuotaLimit();
const quotaLimitInterval = setInterval(
  () => {
    void refreshQuotaLimit();
  },
  24 * 60 * 60 * 1000,
);
quotaLimitInterval.unref();

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down...");
  void engine.stop().then(() => {
    closeDb();
    server.close();
    logger.info("Shutdown complete");
    process.exit(0);
  });

  // Force exit after 5s if graceful shutdown hangs (e.g. open SSE connections)
  setTimeout(() => {
    logger.warn("Forced shutdown after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
