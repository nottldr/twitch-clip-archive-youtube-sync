import type { SyncEvent } from "./events.js";
import type { Notifier, SyncEventPayload } from "./types.js";

import type { SSEManager } from "#server/api/sse.js";

export function createNotificationRegistry(sseManager: SSEManager) {
  const notifiers: Notifier[] = [];

  function register(notifier: Notifier): void {
    notifiers.push(notifier);
  }

  async function emit(event: SyncEvent, data: Record<string, unknown>): Promise<void> {
    const payload: SyncEventPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Always broadcast to SSE clients
    sseManager.broadcast(event, payload.data);

    // Fan out to registered notifiers (fire-and-forget)
    await Promise.allSettled(
      notifiers.filter((n) => n.shouldHandle(event)).map((n) => n.send(payload)),
    );
  }

  function getNotifierNames(): string[] {
    return notifiers.map((n) => n.name);
  }

  return {
    register,
    emit,
    getNotifierNames,
  };
}

export type NotificationRegistry = ReturnType<typeof createNotificationRegistry>;
