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

const defaultDeps = {
  uploadIntervalMs: 1000,
  archivePollIntervalMs: 900_000,
  quotaProbeIntervalMs: 15 * 60 * 1000,
};

function createTestMachine() {
  return createSyncMachine({
    isAuthenticated: () => true,
    canUpload: () => true,
    msUntilQuotaReset: () => 60_000,
    ...defaultDeps,
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
    ...defaultDeps,
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
    ...defaultDeps,
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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

  it("populates waitResumeAt on entry to waiting.quotaExhausted", async () => {
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => false, // forces straight to waiting.quotaExhausted
      msUntilQuotaReset: () => 12 * 60 * 60 * 1000, // 12h until reset
      uploadIntervalMs: 1000,
      archivePollIntervalMs: 900_000,
      quotaProbeIntervalMs: 15 * 60 * 1000,
      importArchive: async () => 0,
      discoverQuota: async () => null,
      selectNextClip: async () => null,
      performUpload: async () => ({ youtubeId: "fake", durationMs: 0 }),
      ...noopSideEffects,
    });

    const before = Date.now();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));
    const ctx = actor.getSnapshot().context;
    expect(ctx.waitResumeAt).not.toBeNull();
    const resumeAtMs = new Date(ctx.waitResumeAt ?? "").getTime();
    expect(resumeAtMs).toBeGreaterThan(before);
    actor.stop();
  });

  it("populates waitResumeAt on entry to waiting.noClips", async () => {
    const machine = createNoClipsMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "noClips" } }));
    const ctx = actor.getSnapshot().context;
    expect(ctx.waitResumeAt).not.toBeNull();
    // noClipsRetry is 30s
    const expected = Date.now() + 30_000;
    const actual = new Date(ctx.waitResumeAt ?? "").getTime();
    expect(actual).toBeGreaterThan(expected - 2_000);
    expect(actual).toBeLessThan(expected + 2_000);
    actor.stop();
  });

  it("populates waitResumeAt on entry to waiting.cooldown after a successful upload", async () => {
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      uploadIntervalMs: 9_999_999, // very long so the test catches us in cooldown
      archivePollIntervalMs: 900_000,
      quotaProbeIntervalMs: 15 * 60 * 1000,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "c1", clipTitle: "c1" }),
      performUpload: async () => ({ youtubeId: "yt-1", durationMs: 1 }),
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }));
    const ctx = actor.getSnapshot().context;
    expect(ctx.waitResumeAt).not.toBeNull();
    actor.stop();
  });

  it("clears waitResumeAt on entry to deciding", async () => {
    const machine = createNoClipsMachine();
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    // Drive into noClips so waitResumeAt is set
    await waitFor(actor, (s) => s.matches({ active: { waiting: "noClips" } }));
    expect(actor.getSnapshot().context.waitResumeAt).not.toBeNull();

    // Send CLIPS_CHANGED to nudge back into deciding
    actor.send({ type: "CLIPS_CHANGED" });
    await waitFor(actor, (s) => s.matches({ active: "deciding" }));
    expect(actor.getSnapshot().context.waitResumeAt).toBeNull();
    actor.stop();
  });

  it("transitions from quotaExhausted to quotaProbing after the probe interval", async () => {
    // canUpload returns false → machine sits in quotaExhausted.
    const canUploadValue = false;
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => canUploadValue,
      msUntilQuotaReset: () => 24 * 60 * 60 * 1000, // 24h — far away
      ...defaultDeps,
      quotaProbeIntervalMs: 100, // 100ms for fast test
      importArchive: async () => 0,
      discoverQuota: async () => null,
      selectNextClip: async () => null, // no clips — probe goes to noClips
      performUpload: async () => ({ youtubeId: "fake", durationMs: 0 }),
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));
    // After 100ms the probe fires → quotaProbing → deciding → (no clip) → noClips
    await waitFor(actor, (s) => s.matches({ active: { waiting: "noClips" } }), {
      timeout: 1000,
    });
    expect(canUploadValue).toBe(false); // we never changed it; probe bypassed the gate
    actor.stop();
  });

  it("probe upload succeeds → reaches cooldown (canUpload was bypassed)", async () => {
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      // canUpload is FALSE the whole time. Without the probe we'd stay in quotaExhausted forever.
      canUpload: () => false,
      msUntilQuotaReset: () => 24 * 60 * 60 * 1000,
      ...defaultDeps,
      quotaProbeIntervalMs: 100,
      uploadIntervalMs: 9_999_999, // trap us in cooldown when probe succeeds
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "probe-clip", clipTitle: "Probe" }),
      performUpload: async () => ({ youtubeId: "yt-probe", durationMs: 1 }),
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));
    // probe interval elapses → quotaProbing → deciding (force=true) → uploading → cooldown
    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }), {
      timeout: 2000,
    });
    actor.stop();
  });

  it("probe upload fails with QUOTA_EXCEEDED → back to quotaExhausted, and retries again", async () => {
    let uploadAttempts = 0;
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => false,
      msUntilQuotaReset: () => 24 * 60 * 60 * 1000,
      ...defaultDeps,
      quotaProbeIntervalMs: 80,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "probe-clip", clipTitle: "Probe" }),
      // Probe also fails with QUOTA_EXCEEDED — quota is genuinely exhausted on YouTube too.
      performUpload: async () => {
        uploadAttempts++;
        throw { error: "Quota exceeded", code: "QUOTA_EXCEEDED" };
      },
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));

    // First probe fires after ~80ms. Wait long enough for two cycles (probe → quotaExhausted → probe again).
    await new Promise((r) => setTimeout(r, 250));

    // We should be back in quotaExhausted (each probe failed) and have attempted upload at least twice.
    expect(actor.getSnapshot().matches({ active: { waiting: "quotaExhausted" } })).toBe(true);
    expect(uploadAttempts).toBeGreaterThanOrEqual(2);
    actor.stop();
  });

  it("forceNextUpload is cleared after the probe upload completes", async () => {
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => false,
      msUntilQuotaReset: () => 24 * 60 * 60 * 1000,
      ...defaultDeps,
      quotaProbeIntervalMs: 100,
      uploadIntervalMs: 9_999_999,
      importArchive: async () => 1,
      discoverQuota: async () => null,
      selectNextClip: async () => ({ clipId: "c1", clipTitle: "c1" }),
      performUpload: async () => ({ youtubeId: "yt-1", durationMs: 1 }),
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }), { timeout: 2000 });
    expect(actor.getSnapshot().context.forceNextUpload).toBe(false);
    actor.stop();
  });

  it("TRIGGER_CLIP from waiting.quotaExhausted bypasses canUpload and starts an upload", async () => {
    const uploadAttempts: string[] = [];
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => false, // pin in quotaExhausted
      msUntilQuotaReset: () => 24 * 60 * 60 * 1000,
      ...defaultDeps,
      quotaProbeIntervalMs: 24 * 60 * 60 * 1000, // long so the probe doesn't interfere
      uploadIntervalMs: 9_999_999,
      importArchive: async () => 0,
      discoverQuota: async () => null,
      selectNextClip: async () => null,
      performUpload: async (clipId) => {
        uploadAttempts.push(clipId);
        return { youtubeId: `yt-${clipId}`, durationMs: 1 };
      },
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "quotaExhausted" } }));
    actor.send({ type: "TRIGGER_CLIP", clipId: "force-me" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }), { timeout: 1000 });
    expect(uploadAttempts).toEqual(["force-me"]);
    actor.stop();
  });

  it("TRIGGER_CLIP from waiting.noClips bypasses selectNextClip", async () => {
    const uploadAttempts: string[] = [];
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      ...defaultDeps,
      uploadIntervalMs: 9_999_999,
      importArchive: async () => 0,
      discoverQuota: async () => null,
      selectNextClip: async () => null, // would normally trap us in noClips
      performUpload: async (clipId) => {
        uploadAttempts.push(clipId);
        return { youtubeId: `yt-${clipId}`, durationMs: 1 };
      },
      ...noopSideEffects,
    });

    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "noClips" } }));
    actor.send({ type: "TRIGGER_CLIP", clipId: "manual-1" });

    await waitFor(actor, (s) => s.matches({ active: { waiting: "cooldown" } }), { timeout: 1000 });
    expect(uploadAttempts).toEqual(["manual-1"]);
    actor.stop();
  });

  it("TRIGGER_CLIP still works from blocked.userPaused (and returns to userPaused)", async () => {
    const uploadAttempts: string[] = [];
    const machine = createSyncMachine({
      isAuthenticated: () => true,
      canUpload: () => true,
      msUntilQuotaReset: () => 60_000,
      ...defaultDeps,
      uploadIntervalMs: 9_999_999,
      importArchive: async () => 0,
      discoverQuota: async () => null,
      selectNextClip: async () => null,
      performUpload: async (clipId) => {
        uploadAttempts.push(clipId);
        return { youtubeId: `yt-${clipId}`, durationMs: 1 };
      },
      ...noopSideEffects,
    });
    // Configure machine to boot into userPaused
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.matches("active"));
    actor.send({ type: "PAUSE" });
    await waitFor(actor, (s) => s.matches({ active: { blocked: "userPaused" } }));

    actor.send({ type: "TRIGGER_CLIP", clipId: "while-paused" });
    // After upload completes, isUserPaused guard sends us back to userPaused (not cooldown)
    await waitFor(
      actor,
      (s) => s.matches({ active: { blocked: "userPaused" } }) && uploadAttempts.length === 1,
      {
        timeout: 1000,
      },
    );
    expect(uploadAttempts).toEqual(["while-paused"]);
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
      quotaProbeIntervalMs: 15 * 60 * 1000,
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
