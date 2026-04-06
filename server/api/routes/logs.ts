import { Hono } from "hono";

import type { EngineLogRepository } from "#server/db/repositories/engine-log.js";

export function createLogsRoutes(logRepo: EngineLogRepository) {
  const app = new Hono();

  app.get("/logs", (c) => {
    const typesParam = c.req.query("type");
    const types = typesParam?.split(",").filter(Boolean);
    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const beforeId = c.req.query("before")
      ? Number.parseInt(c.req.query("before") ?? "0", 10)
      : undefined;

    return c.json(logRepo.query({ types, limit, beforeId }));
  });

  app.post("/logs/clear", (c) => {
    logRepo.clear();
    return c.json({ ok: true });
  });

  return app;
}
