import { describe, expect, it, vi } from "vitest";

import { SyncEvent } from "#server/notifications/events.js";
import { createNotificationRegistry } from "#server/notifications/registry.js";
import type { Notifier, SyncEventPayload } from "#server/notifications/types.js";

function mockSSEManager() {
  return {
    addClient: vi.fn(),
    getStream: vi.fn(),
    removeClient: vi.fn(),
    broadcast: vi.fn(),
    getClientCount: vi.fn(() => 0),
  };
}

function mockNotifier(
  name: string,
  handles: SyncEvent[] = Object.values(SyncEvent),
): Notifier & { send: ReturnType<typeof vi.fn> } {
  return {
    name,
    shouldHandle: (event: SyncEvent) => handles.includes(event),
    send: vi.fn(async () => {}),
  };
}

describe("NotificationRegistry", () => {
  it("calls send() on all notifiers that handle the event", async () => {
    const sse = mockSSEManager();
    const registry = createNotificationRegistry(sse);
    const n1 = mockNotifier("n1");
    const n2 = mockNotifier("n2");

    registry.register(n1);
    registry.register(n2);

    await registry.emit(SyncEvent.UPLOAD_SUCCESS, { clipId: "test" });

    expect(n1.send).toHaveBeenCalledOnce();
    expect(n2.send).toHaveBeenCalledOnce();
  });

  it("does not call notifiers that don't handle the event", async () => {
    const sse = mockSSEManager();
    const registry = createNotificationRegistry(sse);
    const uploadOnly = mockNotifier("upload-only", [SyncEvent.UPLOAD_SUCCESS]);
    const quotaOnly = mockNotifier("quota-only", [SyncEvent.QUOTA_EXHAUSTED]);

    registry.register(uploadOnly);
    registry.register(quotaOnly);

    await registry.emit(SyncEvent.UPLOAD_SUCCESS, { clipId: "test" });

    expect(uploadOnly.send).toHaveBeenCalledOnce();
    expect(quotaOnly.send).not.toHaveBeenCalled();
  });

  it("one notifier throwing does not prevent others from being called", async () => {
    const sse = mockSSEManager();
    const registry = createNotificationRegistry(sse);

    const failing: Notifier = {
      name: "failing",
      shouldHandle: () => true,
      send: async () => {
        throw new Error("boom");
      },
    };
    const working = mockNotifier("working");

    registry.register(failing);
    registry.register(working);

    // Should not throw
    await registry.emit(SyncEvent.UPLOAD_SUCCESS, { clipId: "test" });

    expect(working.send).toHaveBeenCalledOnce();
  });

  it("broadcasts every event to SSE", async () => {
    const sse = mockSSEManager();
    const registry = createNotificationRegistry(sse);

    await registry.emit(SyncEvent.UPLOAD_SUCCESS, { clipId: "test" });

    expect(sse.broadcast).toHaveBeenCalledWith(SyncEvent.UPLOAD_SUCCESS, { clipId: "test" });
  });

  it("passes correct payload shape to notifiers", async () => {
    const sse = mockSSEManager();
    const registry = createNotificationRegistry(sse);
    const n = mockNotifier("n");
    registry.register(n);

    await registry.emit(SyncEvent.QUOTA_EXHAUSTED, { reason: "limit" });

    const payload: SyncEventPayload = n.send.mock.calls[0][0];
    expect(payload.event).toBe(SyncEvent.QUOTA_EXHAUSTED);
    expect(payload.data).toEqual({ reason: "limit" });
    expect(payload.timestamp).toBeTruthy();
  });
});
