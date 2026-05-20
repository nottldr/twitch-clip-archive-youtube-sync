import type { SSEManager } from "./sse.js";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";

import type { Config } from "#server/config.js";
import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { EngineLogRepository } from "#server/db/repositories/engine-log.js";
import type { UploadsRepository } from "#server/db/repositories/uploads.js";
import type { SyncEngine } from "#server/sync/engine.js";
import type { Scheduler } from "#server/sync/scheduler.js";
import type { AuthManager } from "#server/youtube/auth.js";

import { createClipsRoutes } from "./routes/clips.js";
import { createEngineRoutes } from "./routes/engine.js";
import { createEventsRoutes } from "./routes/events.js";
import { createLogsRoutes } from "./routes/logs.js";
import { createOAuthRoutes } from "./routes/oauth.js";
import { createStatsRoutes } from "./routes/stats.js";

export function createApp(
  config: Config,
  clipsRepo: ClipsRepository,
  uploadsRepo: UploadsRepository,
  scheduler: Scheduler,
  engine: SyncEngine,
  authManager: AuthManager,
  sseManager: SSEManager,
  logRepo: EngineLogRepository,
) {
  const app = new Hono();

  // CORS for dev (Vite dev server on different port)
  if (process.env.NODE_ENV !== "production") {
    app.use("/api/*", cors());
  }

  // Health check (no auth, enriched)
  app.get("/health", (c) => {
    const snapshot = engine.getSnapshot();
    return c.json({
      status: "ok",
      engine: snapshot.state,
      oauth: authManager.isAuthenticated(),
      uptime: process.uptime(),
      lastImport: snapshot.context.lastImportAt,
      clipsImported: snapshot.context.clipsImported,
      quotaLimit: snapshot.context.quotaLimit,
    });
  });

  // Optional basic auth
  if (config.adminPassword) {
    const password = config.adminPassword;
    app.use("/api/*", (c, next) => {
      // Skip auth for OAuth callback (Google redirects here)
      if (c.req.path === "/api/oauth/callback") return next();
      return basicAuth({
        username: "admin",
        password,
      })(c, next);
    });
  }

  // API routes
  app.route("/api", createStatsRoutes(clipsRepo, scheduler, engine));
  app.route("/api", createClipsRoutes(clipsRepo, uploadsRepo, logRepo, engine));
  app.route("/api", createOAuthRoutes(authManager, engine));
  app.route("/api", createEngineRoutes(engine, authManager, config));
  app.route("/api", createLogsRoutes(logRepo));
  app.route("/api", createEventsRoutes(sseManager));

  // Serve static frontend in production
  app.use("/*", serveStatic({ root: "./web/dist" }));
  // SPA fallback
  app.use("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

  return app;
}
