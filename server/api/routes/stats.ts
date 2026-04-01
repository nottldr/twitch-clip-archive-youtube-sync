import { Hono } from "hono";

import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { SyncEngine } from "#server/sync/engine.js";
import type { Scheduler } from "#server/sync/scheduler.js";

export function createStatsRoutes(
  clipsRepo: ClipsRepository,
  scheduler: Scheduler,
  engine: SyncEngine,
) {
  const app = new Hono();

  app.get("/stats", (c) => {
    const stats = clipsRepo.getStats();
    const quota = scheduler.getQuotaUsage();
    const estimated = scheduler.getEstimatedCompletion(stats.pending + stats.failed);

    return c.json({
      clips: stats,
      quota,
      engine: {
        status: engine.getStatus(),
        syncMode: engine.getSyncMode(),
        paused: engine.isPaused(),
        currentUpload: engine.getCurrentUpload(),
      },
      estimated,
    });
  });

  app.get("/quota", (c) => {
    return c.json(scheduler.getQuotaUsage());
  });

  app.get("/quota/history", (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    return c.json(scheduler.getQuotaHistory(Math.min(days, 365)));
  });

  app.get("/activity", (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "10", 10);
    return c.json(clipsRepo.getRecentActivity(Math.min(limit, 50)));
  });

  return app;
}
