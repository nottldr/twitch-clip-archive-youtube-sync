import type { SyncEvent } from "../events.js";
import type { Notifier, SyncEventPayload } from "../types.js";

export function createWebhookNotifier(url: string, events: string[]): Notifier {
  const handleEvents = new Set(events);

  return {
    name: "webhook",

    shouldHandle(event: SyncEvent): boolean {
      return handleEvents.has(event);
    },

    async send(payload: SyncEventPayload): Promise<void> {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // Log but don't throw. Notifications should never break the sync loop.
      }
    },
  };
}
