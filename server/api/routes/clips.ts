import { Hono } from "hono";
import { z } from "zod/v4";

import type { ClipsRepository } from "#server/db/repositories/clips.js";

const SortBySchema = z.enum(["created_at", "title", "sync_status"]);
const SortOrderSchema = z.enum(["asc", "desc"]);

export function createClipsRoutes(clipsRepo: ClipsRepository) {
  const app = new Hono();

  app.get("/clips", (c) => {
    const status = c.req.query("status");
    const search = c.req.query("search");
    const sortBy = SortBySchema.safeParse(c.req.query("sortBy"));
    const sortOrder = SortOrderSchema.safeParse(c.req.query("sortOrder"));
    const page = Number.parseInt(c.req.query("page") ?? "1", 10);
    const pageSize = Number.parseInt(c.req.query("pageSize") ?? "50", 10);

    // Support comma-separated statuses: ?status=failed,uploading
    const statuses = status?.split(",").filter(Boolean);

    const result = clipsRepo.getClipsPaginated({
      statuses,
      search,
      sortBy: sortBy.success ? sortBy.data : undefined,
      sortOrder: sortOrder.success ? sortOrder.data : undefined,
      page,
      pageSize: Math.min(pageSize, 200),
    });

    return c.json(result);
  });

  app.post("/clips/:clipId/reset", (c) => {
    const clipId = c.req.param("clipId");
    const reset = clipsRepo.resetClip(clipId);
    return c.json({ ok: reset });
  });

  return app;
}
