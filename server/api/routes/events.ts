import type { SSEManager } from "../sse.js";

import { randomUUID } from "node:crypto";

import { Hono } from "hono";

export function createEventsRoutes(sseManager: SSEManager) {
  const app = new Hono();

  app.get("/events", (_c) => {
    const clientId = randomUUID();
    const { stream } = sseManager.addClient(clientId);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
