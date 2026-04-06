import { createSyncMachine } from "#shared/sync-machine.js";
import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

const noopSideEffects = {
  onClipUploading: () => {},
  onClipUploaded: () => {},
  onClipFailed: () => {},
  onQuotaRecorded: () => {},
  onQuotaLimitExceeded: () => {},
};

function createTestMachine() {
  return createSyncMachine({
    isAuthenticated: () => true,
    canUpload: () => true,
    msUntilQuotaReset: () => 60_000,
    uploadIntervalMs: 1000,
    archivePollIntervalMs: 900_000,
    importArchive: async () => 10,
    discoverQuota: async () => 10_000,
    selectNextClip: async () => ({ clipId: "test-clip", clipTitle: "Test Clip" }),
    performUpload: async () => ({ youtubeId: "fake-yt-id", durationMs: 100 }),
    ...noopSideEffects,
  });
}

function createNoClipsMachine() {
  return createSyncMachine({
    isAuthenticated: () => true,
    canUpload: () => true,
    msUntilQuotaReset: () => 60_000,
    uploadIntervalMs: 1000,
    archivePollIntervalMs: 900_000,
    importArchive: async () => 0,
    discoverQuota: async () => null,
    selectNextClip: async () => null,
    performUpload: async () => ({ youtubeId: "fake", durationMs: 0 }),
    ...noopSideEffects,
  });
}

function createUnauthMachine() {
  return createSyncMachine({
    isAuthenticated: () => false,
    canUpload: () => true,
    msUntilQuotaReset: () => 60_000,
    uploadIntervalMs: 1000,
    archivePollIntervalMs: 900_000,
    importArchive: async () => 0,
    discoverQuota: async () => null,
    selectNextClip: async () => null,
    performUpload: async () => ({ youtubeId: "fake", durationMs: 0 }),
    ...noopSideEffects,
  });
}

describe("sync machine structure", () => {
  it("has valid machine definition", () => {
    const machine = createTestMachine();
    expect(machine.id).toBe("sync");
  });

  it("starts in stopped state", () => {
    const machine = createTestMachine();
    const actor = createActor(machine);
    actor.start();
    expect(actor.getSnapshot().value).toBe("stopped");
    actor.stop();
  });

  it("transitions to starting on START event", () => {
    const machine = createTestMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });
    expect(actor.getSnapshot().matches({ starting: "importingArchive" })).toBe(true);
    actor.stop();
  });

  it("handles STOP from any state", () => {
    const machine = createTestMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });
    actor.send({ type: "STOP" });
    expect(actor.getSnapshot().value).toBe("stopped");
    actor.stop();
  });

  it("reaches active state after starting", async () => {
    const machine = createNoClipsMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    // waitFor waits until the actor matches the predicate
    await waitFor(actor, (s) => s.matches("active"));
    expect(actor.getSnapshot().matches("active")).toBe(true);
    actor.stop();
  });

  it("handles PAUSE in active state", async () => {
    const machine = createNoClipsMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches("active"));
    actor.send({ type: "PAUSE" });
    expect(actor.getSnapshot().matches({ active: { blocked: "userPaused" } })).toBe(true);
    actor.stop();
  });

  it("handles RESUME from paused state", async () => {
    const machine = createNoClipsMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches("active"));
    actor.send({ type: "PAUSE" });
    expect(actor.getSnapshot().matches({ active: { blocked: "userPaused" } })).toBe(true);

    actor.send({ type: "RESUME" });
    await waitFor(actor, (s) => !s.matches({ active: { blocked: "userPaused" } }));
    expect(actor.getSnapshot().matches({ active: { blocked: "userPaused" } })).toBe(false);
    actor.stop();
  });

  it("goes to awaitingAuth when not authenticated", async () => {
    const machine = createUnauthMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { blocked: "awaitingAuth" } }));
    expect(actor.getSnapshot().matches({ active: { blocked: "awaitingAuth" } })).toBe(true);
    actor.stop();
  });

  it("handles debug flag events", () => {
    const machine = createTestMachine();
    const actor = createActor(machine);
    actor.start();

    actor.send({ type: "DEBUG_SET_FORCE_FAIL", value: true });
    expect(actor.getSnapshot().context.debugForceFailNextUpload).toBe(true);

    actor.send({ type: "DEBUG_CLEAR_ALL" });
    expect(actor.getSnapshot().context.debugForceFailNextUpload).toBe(false);
    actor.stop();
  });

  it("calls onClipUploading when entering uploading state", async () => {
    const uploadingClips: string[] = [];
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "clip-1", clipTitle: "Test" }),
      performUpload: async () => ({ youtubeId: "yt-1", durationMs: 100 }),
      ...noopSideEffects,
      onClipUploading: (clipId) => {
        uploadingClips.push(clipId);
      },
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(
      actor,
      (s) => s.matches({ active: "uploading" }) || s.matches({ active: { waiting: "cooldown" } }),
    );
    expect(uploadingClips).toContain("clip-1");
    actor.stop();
  });

  it("calls onClipUploaded and onQuotaRecorded on UPLOAD_COMPLETE", async () => {
    const uploadedClips: Array<{ clipId: string; youtubeId: string }> = [];
    let quotaRecorded = false;

    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 999_999, // long cooldown so it stays in waiting
      archivePollIntervalMs: 900_000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "clip-1", clipTitle: "Test" }),
      performUpload: async () => ({ youtubeId: "yt-1", durationMs: 100 }),
      ...noopSideEffects,
      onClipUploaded: (clipId, youtubeId) => {
        uploadedClips.push({ clipId, youtubeId });
      },
      onQuotaRecorded: () => {
        quotaRecorded = true;
      },
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }));
    expect(uploadedClips).toEqual([{ clipId: "clip-1", youtubeId: "yt-1" }]);
    expect(quotaRecorded).toBe(true);
    actor.stop();
  });

  it("calls onQuotaLimitExceeded on quota error", async () => {
    let limitExceeded = false;

    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "clip-1", clipTitle: "Test" }),
      performUpload: async () => {
        throw { error: "Quota exceeded", code: "QUOTA_EXCEEDED" };
      },
      ...noopSideEffects,
      onQuotaLimitExceeded: () => {
        limitExceeded = true;
      },
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));
    expect(limitExceeded).toBe(true);
    actor.stop();
  });

  it("calls onClipFailed on non-quota upload error", async () => {
    const failures: Array<{ clipId: string; error: string; code: string }> = [];

    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "clip-1", clipTitle: "Test" }),
      performUpload: async () => {
        throw { error: "Bad request", code: "BAD_REQUEST" };
      },
      ...noopSideEffects,
      onClipFailed: (clipId, error, code) => {
        failures.push({ clipId, error, code });
      },
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "error" } }));
    expect(failures).toEqual([{ clipId: "clip-1", error: "Bad request", code: "BAD_REQUEST" }]);
    actor.stop();
  });

  it("PAUSE during upload lets upload finish, then pauses", async () => {
    const uploaded: Array<{ clipId: string; youtubeId: string }> = [];
    let resolveUpload: ((result: { youtubeId: string; durationMs: number }) => void) | null = null;

    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "clip-1", clipTitle: "Test" }),
      performUpload: () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      ...noopSideEffects,
      onClipUploaded: (clipId, youtubeId) => {
        uploaded.push({ clipId, youtubeId });
      },
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    // Wait for upload to begin
    await waitFor(actor, (s) => s.matches({ active: "uploading" }));

    // Pause while uploading — should NOT leave uploading state
    actor.send({ type: "PAUSE" });
    expect(actor.getSnapshot().matches({ active: "uploading" })).toBe(true);
    expect(actor.getSnapshot().context.userPaused).toBe(true);

    // Complete the upload
    resolveUpload!({ youtubeId: "yt-1", durationMs: 100 });

    // Should transition to userPaused (not cooldown)
    await waitFor(actor, (s) => s.matches({ active: { blocked: "userPaused" } }));
    expect(uploaded).toEqual([{ clipId: "clip-1", youtubeId: "yt-1" }]);
    actor.stop();
  });

  it("AUTH_COMPLETE transitions to rediscovering (not deciding)", async () => {
    let discoveredCount = 0;
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      importArchive: async () => 0,
      discoverQuota: async () => {
        discoveredCount++;
        return 10_000;
      },
      selectNextClip: async () => null,
      performUpload: async () => ({ youtubeId: "fake", durationMs: 0 }),
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    // Wait for initial startup discovery
    await waitFor(actor, (s) => s.matches("active"));
    const initialCount = discoveredCount;

    // Simulate losing and regaining auth
    actor.send({ type: "AUTH_LOST" });
    await waitFor(actor, (s) => s.matches({ active: { blocked: "awaitingAuth" } }));

    actor.send({ type: "AUTH_COMPLETE" });
    // Should go through rediscovering before deciding
    await waitFor(
      actor,
      (s) =>
        s.matches({ active: "rediscovering" }) || s.matches({ active: { waiting: "noClips" } }),
    );

    // Discovery should have been called again
    expect(discoveredCount).toBeGreaterThan(initialCount);
    actor.stop();
  });
});
