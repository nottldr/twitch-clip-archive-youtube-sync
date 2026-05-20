import { Hono } from "hono";
import { z } from "zod/v4";

import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { EngineLogRepository } from "#server/db/repositories/engine-log.js";
import type { UploadsRepository } from "#server/db/repositories/uploads.js";
import type { SyncEngine } from "#server/sync/engine.js";

const SortBySchema = z.enum(["created_at", "title", "sync_status", "retry_count"]);
const SortOrderSchema = z.enum(["asc", "desc"]);

const BulkActionRequestSchema = z.object({
  action: z.enum(["ignore", "reset", "retry"]),
  clipIds: z.array(z.string().min(1)).min(1).max(500),
});

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function createClipsRoutes(
  clipsRepo: ClipsRepository,
  uploadsRepo: UploadsRepository,
  logRepo: EngineLogRepository,
  engine: SyncEngine,
) {
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

  /**
   * Server-side CSV export. Honors the same status/search filters as GET /clips
   * but returns every matching row, not just the current page. Mounted before
   * /clips/:clipId to win the path match.
   */
  app.get("/clips/export", (c) => {
    const status = c.req.query("status");
    const search = c.req.query("search");
    const statuses = status?.split(",").filter(Boolean);

    // Fetch all matching rows. We use the paginated method with a very large
    // pageSize for now — the dataset is bounded (thousands, not millions).
    const { clips } = clipsRepo.getClipsPaginated({
      statuses,
      search,
      sortBy: "created_at",
      sortOrder: "asc",
      page: 1,
      pageSize: 100_000,
    });

    const header = [
      "clip_id",
      "title",
      "broadcaster_name",
      "creator_name",
      "sync_status",
      "youtube_id",
      "uploaded_at",
      "last_error",
      "retry_count",
      "view_count",
      "created_at",
      "url",
    ];
    const rows = clips.map((clip) =>
      [
        clip.clip_id,
        clip.title,
        clip.broadcaster_name,
        clip.creator_name,
        clip.sync_status,
        clip.youtube_id,
        clip.uploaded_at,
        clip.last_error,
        clip.retry_count,
        clip.view_count,
        clip.created_at,
        clip.url,
      ]
        .map(csvEscape)
        .join(","),
    );
    const body = [header.join(","), ...rows].join("\n") + "\n";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clips-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });

  /**
   * Per-clip detail surface. The UI's detail drawer hits this and renders the
   * full clip metadata + recent attempt history + recent engine_log entries
   * mentioning the clip — single round-trip.
   */
  app.get("/clips/:clipId", (c) => {
    const clipId = c.req.param("clipId");
    const clip = clipsRepo.getById(clipId);
    if (!clip) return c.json({ error: "Clip not found" }, 404);

    const attempts = uploadsRepo.getAttemptsByClip(clipId, { limit: 50 });
    const logs = logRepo.query({ clipId, limit: 50 });

    return c.json({
      clip,
      attempts: attempts.attempts,
      attemptsHasMore: attempts.hasMore,
      logs: logs.entries,
      logsHasMore: logs.hasMore,
    });
  });

  app.get("/clips/:clipId/attempts", (c) => {
    const clipId = c.req.param("clipId");
    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const beforeId = c.req.query("before")
      ? Number.parseInt(c.req.query("before") ?? "0", 10)
      : undefined;
    return c.json(uploadsRepo.getAttemptsByClip(clipId, { limit, beforeId }));
  });

  app.post("/clips/:clipId/reset", (c) => {
    const clipId = c.req.param("clipId");
    const reset = clipsRepo.resetClip(clipId);
    return c.json({ ok: reset });
  });

  /**
   * Single-call retry: reset retry_count/sync_status/error and tell the engine
   * to pick this clip up. Subsumes the old reset-then-trigger pattern.
   */
  app.post("/clips/:clipId/retry", (c) => {
    const clipId = c.req.param("clipId");
    const result = engine.retryClip(clipId);
    if (!result.reset)
      return c.json({ ok: false, error: "Clip not found or already pending" }, 404);
    return c.json({ ok: true });
  });

  /**
   * Atomic bulk action over a list of clip IDs. Either every row's mutation
   * lands or none does (transactional). 'retry' and 'reset' also nudge the
   * engine so the affected clips get picked up immediately.
   */
  app.post("/clips/bulk", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = BulkActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.format() }, 400);
    }
    const result = engine.bulkClipAction(parsed.data);
    return c.json(result);
  });

  return app;
}
