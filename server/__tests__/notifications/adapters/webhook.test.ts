import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWebhookNotifier } from "#server/notifications/adapters/webhook.js";
import { SyncEvent } from "#server/notifications/events.js";

const mockFetch = vi.fn(async () => new Response("ok"));

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhookNotifier", () => {
  it("sends POST to configured URL for handled events", async () => {
    const notifier = createWebhookNotifier("https://hooks.example.com/notify", [
      SyncEvent.UPLOAD_SUCCESS,
    ]);

    await notifier.send({
      event: SyncEvent.UPLOAD_SUCCESS,
      timestamp: "2026-01-01T00:00:00Z",
      data: { clipId: "test-123", youtubeId: "yt-456" },
    });

    expect(mockFetch).toHaveBeenCalledWith("https://hooks.example.com/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining("test-123"),
    });
  });

  it("only handles events in the configured list", () => {
    const notifier = createWebhookNotifier("https://hooks.example.com", [
      SyncEvent.UPLOAD_SUCCESS,
      SyncEvent.QUOTA_EXHAUSTED,
    ]);

    expect(notifier.shouldHandle(SyncEvent.UPLOAD_SUCCESS)).toBe(true);
    expect(notifier.shouldHandle(SyncEvent.QUOTA_EXHAUSTED)).toBe(true);
    expect(notifier.shouldHandle(SyncEvent.UPLOAD_FAILURE)).toBe(false);
    expect(notifier.shouldHandle(SyncEvent.SYNC_ERROR)).toBe(false);
  });

  it("does not throw on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const notifier = createWebhookNotifier("https://hooks.example.com", [SyncEvent.UPLOAD_SUCCESS]);

    // Should not throw
    await notifier.send({
      event: SyncEvent.UPLOAD_SUCCESS,
      timestamp: "2026-01-01T00:00:00Z",
      data: { clipId: "test" },
    });
  });
});
