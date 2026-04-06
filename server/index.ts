import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";

import { createApp } from "#server/api/app.js";
import { createSSEManager } from "#server/api/sse.js";
import { loadConfig } from "#server/config.js";
import { closeDb, getDb } from "#server/db/connection.js";
import { createClipsRepository } from "#server/db/repositories/clips.js";
import { createEngineLogRepository } from "#server/db/repositories/engine-log.js";
import { createEngineStateRepository } from "#server/db/repositories/engine-state.js";
import { createOAuthRepository } from "#server/db/repositories/oauth.js";
import { createQuotaRepository } from "#server/db/repositories/quota.js";
import { createUploadsRepository } from "#server/db/repositories/uploads.js";
import { createLogger } from "#server/logger.js";
import { type EngineEventHandler, createSyncEngine } from "#server/sync/engine.js";
import { createScheduler } from "#server/sync/scheduler.js";
import { createAuthManager, createDryRunAuthManager } from "#server/youtube/auth.js";

const config = loadConfig();
const logger = createLogger("server");

// Database
const db = getDb(config.dataPath);
const clipsRepo = createClipsRepository(db);
const uploadsRepo = createUploadsRepository(db);
const quotaRepo = createQuotaRepository(db);
const oauthRepo = createOAuthRepository(db);
const logRepo = createEngineLogRepository(db);
const engineStateRepo = createEngineStateRepository(db);

// YouTube auth
const authManager = config.dryRun
  ? createDryRunAuthManager(`http://localhost:${config.port}`, oauthRepo)
  : createAuthManager(config, oauthRepo);

// Scheduler
const scheduler = createScheduler(quotaRepo, config.dailyQuotaLimit, config.uploadCost);

// SSE
const sseManager = createSSEManager();

// Engine event handler: SSE broadcasts + DB logging on state changes
let previousLogState = "";
const eventHandler: EngineEventHandler = {
  onStateChange(snapshot) {
    logger.info({ state: snapshot.state }, "Engine state changed");
    sseManager.broadcast("engine:state", snapshot);
    if (snapshot.state !== previousLogState) {
      logRepo.insert({
        type: "state_change",
        fromState: previousLogState || null,
        toState: snapshot.state,
        message: previousLogState
          ? `${previousLogState} → ${snapshot.state}`
          : `Initial: ${snapshot.state}`,
      });
      previousLogState = snapshot.state;
    }
  },
  onUploadProgress(clipId, bytesTransferred, totalBytes) {
    sseManager.broadcast("engine:upload-progress", { clipId, bytesTransferred, totalBytes });
  },
};

// Sync engine
const engine = createSyncEngine(
  config,
  clipsRepo,
  uploadsRepo,
  scheduler,
  authManager,
  engineStateRepo,
  eventHandler,
);

// Hono app
const app = createApp(config, clipsRepo, scheduler, engine, authManager, sseManager, logRepo);

// Start server, wait for it to be listening before starting the engine
// eslint-disable-next-line typescript/no-misused-promises -- getRequestListener returns async handler by design
const server = createServer(getRequestListener(app.fetch));
await new Promise<void>((resolve, reject) => {
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error({ port: config.port }, "Port already in use");
    } else {
      logger.error({ error }, "Server error");
    }
    reject(error);
  });
  server.listen(config.port, () => {
    logger.info({ port: config.port, dryRun: config.dryRun }, "Server started");
    resolve();
  });
});

// Start sync engine (XState actor)
logger.info({ archivePath: config.archivePath, dataPath: config.dataPath }, "Starting sync engine");
engine.start();

// Graceful shutdown — close all connections, wait for port release, then exit.
function shutdown() {
  server.closeAllConnections();
  server.close(() => {
    engine.stop();
    closeDb();
    process.exit(0);
  });
  // Force exit if close() hangs (e.g. leaked connections)
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
