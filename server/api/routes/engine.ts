import { Hono } from "hono";

import type { Config } from "#server/config.js";
import type { SyncEngine } from "#server/sync/engine.js";
import { getRawQuotaMetrics } from "#server/sync/quota-discovery.js";
import type { AuthManager } from "#server/youtube/auth.js";

export function createEngineRoutes(engine: SyncEngine, authManager: AuthManager, config: Config) {
  const app = new Hono();

  app.get("/engine/status", (c) => {
    return c.json({
      status: engine.getStatus(),
      syncMode: engine.getSyncMode(),
      paused: engine.isPaused(),
      currentUpload: engine.getCurrentUpload(),
    });
  });

  app.get("/engine/debug/quota-metrics", async (c) => {
    if (!config.googleProjectNumber) {
      return c.json({ error: "GOOGLE_PROJECT_NUMBER not set" }, 400);
    }
    const raw = await getRawQuotaMetrics(authManager, config.googleProjectNumber);
    return c.json(raw);
  });

  app.post("/engine/pause", (c) => {
    engine.pause();
    return c.json({ ok: true, status: engine.getStatus() });
  });

  app.post("/engine/resume", (c) => {
    engine.resume();
    return c.json({ ok: true, status: engine.getStatus() });
  });

  app.post("/engine/trigger", async (c) => {
    const result = await engine.triggerUpload();
    return c.json(result);
  });

  app.post("/engine/reset-failed", (c) => {
    const result = engine.resetFailedClips();
    return c.json(result);
  });

  app.post("/engine/reset-all", (c) => {
    const result = engine.resetAllClips();
    return c.json(result);
  });

  return app;
}
