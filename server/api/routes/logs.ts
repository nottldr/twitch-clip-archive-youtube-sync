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

    // Treat missing AND empty-string query params as "no filter".
    const opt = (name: string): string | undefined => {
      const v = c.req.query(name);
      return v && v.length > 0 ? v : undefined;
    };

    return c.json(
      logRepo.query({
        types,
        limit,
        beforeId,
        clipId: opt("clipId"),
        since: opt("since"),
        until: opt("until"),
        errorCode: opt("errorCode"),
      }),
    );
  });

  app.post("/logs/clear", (c) => {
    logRepo.clear();
    return c.json({ ok: true });
  });

  return app;
}
