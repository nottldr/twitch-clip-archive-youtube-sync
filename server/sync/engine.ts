import type { EngineSnapshot, EngineStatePath } from "#shared/schemas.js";
import type { Scheduler } from "./scheduler.js";

import { statSync } from "node:fs";
import { resolve } from "node:path";

import {
  type SyncEvent,
  type SyncMachine,
  type UploadResult,
  createSyncMachine,
} from "#shared/sync-machine.js";
import { Temporal } from "@js-temporal/polyfill";
import { type SnapshotFrom, createActor } from "xstate";

import { readLatestDump } from "#server/archive/reader.js";
import type { Config } from "#server/config.js";
import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { EngineStateRepository } from "#server/db/repositories/engine-state.js";
import type { UploadsRepository } from "#server/db/repositories/uploads.js";
import { createLogger } from "#server/logger.js";
import type { AuthManager } from "#server/youtube/auth.js";
import { UploadError, uploadClip } from "#server/youtube/uploader.js";

import { discoverQuotaLimit } from "./quota-discovery.js";

const logger = createLogger("engine");

export interface EngineEventHandler {
  onStateChange(snapshot: EngineSnapshot): void;
  onUploadProgress(clipId: string, bytesTransferred: number, totalBytes: number): void;
  /** A clip successfully uploaded. */
  onClipUploaded(clipId: string, youtubeId: string): void;
  /** A clip failed in a way that faulted the clip (clip status now 'failed'). */
  onClipFailed(clipId: string, errorCode: string, errorMessage: string): void;
  /** A clip was permanently skipped (missing file, too small, etc.). */
  onClipSkipped(clipId: string, reason: string): void;
}

const noopHandler: EngineEventHandler = {
  onStateChange: () => {},
  onUploadProgress: () => {},
  onClipUploaded: () => {},
  onClipFailed: () => {},
  onClipSkipped: () => {},
};

export function createSyncEngine(
  config: Config,
  clipsRepo: ClipsRepository,
  uploadsRepo: UploadsRepository,
  scheduler: Scheduler,
  authManager: AuthManager,
  engineStateRepo: EngineStateRepository,
  eventHandler: EngineEventHandler = noopHandler,
) {
  // Create the XState machine with injected dependencies
  const machine = createSyncMachine({
    isAuthenticated: () => authManager.isAuthenticated(),
    canUpload: () => scheduler.canUpload(),
    msUntilQuotaReset: () => scheduler.msUntilQuotaReset(),
    uploadIntervalMs: config.uploadIntervalMs,
    archivePollIntervalMs: config.archivePollIntervalMs,
    quotaProbeIntervalMs: config.quotaProbeIntervalMs,
    initialUserPaused: engineStateRepo.isUserPaused(),

    async importArchive() {
      const clips = readLatestDump(config.archivePath, {
        legacyMinAgeMs: config.readerLegacyFreshnessMs,
      });
      if (clips.length === 0) return 0;
      const imported = clipsRepo.upsertFromArchive(clips);
      if (config.ignoredClipIds.length > 0) {
        clipsRepo.markIgnored(config.ignoredClipIds);
      }
      return imported;
    },

    async discoverQuota() {
      if (!config.googleProjectNumber) return null;
      const limit = await discoverQuotaLimit(authManager, config.googleProjectNumber);
      if (limit !== null) {
        scheduler.setDiscoveredLimit(limit);
      }
      return limit;
    },

    performUpload(clipId, onProgress) {
      return doUpload(clipId, onProgress);
    },

    // Side effects (called by XState actions on transitions). DB writes for
    // success/failure happen inside doUpload() above and are atomic — the
    // callbacks below are now log-only / system-state-only.
    onClipUploading(clipId) {
      clipsRepo.markUploading(clipId);
      logger.info({ clipId }, "Clip uploading");
    },
    onClipUploaded(clipId, youtubeId) {
      logger.info({ clipId, youtubeId }, "Upload success");
      eventHandler.onClipUploaded(clipId, youtubeId);
    },
    onClipFailed(clipId, error, code) {
      logger.warn({ clipId, error, code }, "Upload failure");
      eventHandler.onClipFailed(clipId, code, error);
    },
    onQuotaRecorded() {
      // Quota was already recorded atomically with the upload write — no-op.
    },
    onQuotaLimitExceeded() {
      // Reset the in-flight 'uploading' clip back to 'pending' so it'll be
      // retried after the quota window clears.
      clipsRepo.resetInterrupted();
    },

    async selectNextClip() {
      // Reset any stuck "uploading" clips first
      clipsRepo.resetInterrupted();

      const clip = clipsRepo.getNextPending() ?? clipsRepo.getNextRetryable(config.maxRetryCount);

      if (!clip) return null;

      // Validate file exists
      const mp4Path = resolve(config.archivePath, "media/clips", `${clip.clip_id}.mp4`);

      try {
        const stat = statSync(mp4Path);
        if (stat.size < 1024) {
          const reason = `MP4 too small (${stat.size} bytes)`;
          clipsRepo.markSkipped(clip.clip_id, reason);
          logger.warn({ clipId: clip.clip_id, reason }, "Clip skipped");
          eventHandler.onClipSkipped(clip.clip_id, reason);
          return null;
        }
      } catch {
        const reason = "MP4 file not found";
        clipsRepo.markSkipped(clip.clip_id, reason);
        logger.warn({ clipId: clip.clip_id }, "Clip skipped: MP4 file not found");
        eventHandler.onClipSkipped(clip.clip_id, reason);
        return null;
      }

      return { clipId: clip.clip_id, clipTitle: clip.title };
    },
  });

  const actor = createActor(machine);
  let previousStatePath: EngineStatePath = "stopped";

  type MachineSnapshot = SnapshotFrom<SyncMachine>;

  /** Resolve an XState snapshot to our typed enum using matches() */
  function resolveStatePath(s: MachineSnapshot): EngineStatePath {
    if (s.matches({ active: { waiting: "quotaExhausted" } }))
      return "active.waiting.quotaExhausted";
    if (s.matches({ active: { waiting: "quotaProbing" } })) return "active.waiting.quotaProbing";
    if (s.matches({ active: { waiting: "uploadLimit" } })) return "active.waiting.uploadLimit";
    if (s.matches({ active: { waiting: "cooldown" } })) return "active.waiting.cooldown";
    if (s.matches({ active: { waiting: "noClips" } })) return "active.waiting.noClips";
    if (s.matches({ active: { waiting: "error" } })) return "active.waiting.error";
    if (s.matches({ active: { blocked: "awaitingAuth" } })) return "active.blocked.awaitingAuth";
    if (s.matches({ active: { blocked: "userPaused" } })) return "active.blocked.userPaused";
    if (s.matches({ active: "uploading" })) return "active.uploading";
    if (s.matches({ active: "deciding" })) return "active.deciding";
    if (s.matches({ active: "reimporting" })) return "active.reimporting";
    if (s.matches({ active: "rediscovering" })) return "active.rediscovering";
    if (s.matches({ starting: "importingArchive" })) return "starting.importingArchive";
    if (s.matches({ starting: "discoveringQuota" })) return "starting.discoveringQuota";
    if (s.matches({ starting: "settling" })) return "starting.settling";
    if (s.matches("stopped")) return "stopped";
    return "stopped";
  }

  // Subscribe to state changes and progress updates
  let lastBytesTransferred: number | null = null;
  let lastUserPaused = false;
  actor.subscribe((snapshot) => {
    const statePath = resolveStatePath(snapshot);
    const ctx = snapshot.context;

    // Broadcast on state path change or userPaused flag change
    if (statePath !== previousStatePath || ctx.userPaused !== lastUserPaused) {
      previousStatePath = statePath;
      lastUserPaused = ctx.userPaused;
      eventHandler.onStateChange(getSnapshot());
    }

    // Broadcast upload progress (only when bytes change)
    if (
      ctx.clipId &&
      ctx.bytesTransferred !== null &&
      ctx.bytesTransferred !== lastBytesTransferred
    ) {
      lastBytesTransferred = ctx.bytesTransferred;
      eventHandler.onUploadProgress(ctx.clipId, ctx.bytesTransferred, ctx.totalBytes ?? 0);
    } else if (!ctx.clipId) {
      lastBytesTransferred = null;
    }
  });

  function getSnapshot(): EngineSnapshot {
    const snapshot = actor.getSnapshot();
    const ctx = snapshot.context;
    return {
      state: resolveStatePath(snapshot),
      context: {
        clipId: ctx.clipId,
        clipTitle: ctx.clipTitle,
        uploadStartedAt: ctx.uploadStartedAt,
        bytesTransferred: ctx.bytesTransferred,
        totalBytes: ctx.totalBytes,
        waitResumeAt: ctx.waitResumeAt,
        lastError: ctx.lastError,
        lastImportAt: ctx.lastImportAt,
        clipsImported: ctx.clipsImported,
        lastQuotaDiscoveryAt: ctx.lastQuotaDiscoveryAt,
        quotaLimit: ctx.quotaLimit,
        userPaused: ctx.userPaused,
      },
      tasks: {
        archiveImport: {
          lastRunAt: ctx.lastImportAt,
          nextRunAt: ctx.lastImportAt
            ? Temporal.Instant.from(ctx.lastImportAt)
                .add({ milliseconds: config.archivePollIntervalMs })
                .toString()
            : null,
          status:
            snapshot.matches({ active: "reimporting" }) ||
            snapshot.matches({ starting: "importingArchive" })
              ? "running"
              : "idle",
        },
        quotaDiscovery: {
          lastRunAt: ctx.lastQuotaDiscoveryAt,
          nextRunAt: ctx.lastQuotaDiscoveryAt
            ? Temporal.Instant.from(ctx.lastQuotaDiscoveryAt).add({ hours: 24 }).toString()
            : null,
          status:
            snapshot.matches({ active: "rediscovering" }) ||
            snapshot.matches({ starting: "discoveringQuota" })
              ? "running"
              : "idle",
        },
      },
    };
  }

  // Inner upload functions return the YouTube ID + timing. They do NOT touch
  // the DB — the outer `doUpload` wrapper owns the attempt-row lifecycle and
  // commits the final state atomically via uploadsRepo.recordSuccess / recordFailure.
  type InnerUploadFn = (
    clipId: string,
    onProgress: (bytesTransferred: number, totalBytes: number) => void,
  ) => Promise<UploadResult>;

  const doDryRunInner: InnerUploadFn = async (_clipId, onProgress) => {
    const fakeTotal = Math.floor(Math.random() * 10_000_000) + 1_000_000;
    const fakeDuration = Math.floor(Math.random() * 10_000) + 5_000;
    const steps = Math.floor(fakeDuration / 1000);
    const stepMs = Math.floor(fakeDuration / steps);

    await new Promise<void>((done) => {
      let step = 0;
      const tick = () => {
        step++;
        const bytes = Math.floor((fakeTotal * step) / steps);
        onProgress(bytes, fakeTotal);
        if (step >= steps) {
          done();
        } else {
          setTimeout(tick, stepMs);
        }
      };
      setTimeout(tick, stepMs);
    });

    return { youtubeId: `dry-run-${Date.now().toString(36)}`, durationMs: fakeDuration };
  };

  const doRealInner: InnerUploadFn = async (clipId, _onProgress) => {
    const youtube = await authManager.getAuthenticatedClient();
    if (!youtube) {
      throw new UploadError("Not authenticated", "UNAUTHORIZED", true);
    }

    const twitchClip = await getClipData(clipId);
    if (!twitchClip) {
      throw new UploadError("Clip not found in DB", "NOT_FOUND", false);
    }

    const startTime = Date.now();
    const result = await uploadClip(
      twitchClip,
      config.archivePath,
      youtube,
      config.descriptionTemplate,
    );
    return { youtubeId: result.youtubeId, durationMs: Date.now() - startTime };
  };

  const innerUpload: InnerUploadFn = config.dryRun ? doDryRunInner : doRealInner;

  // Owns the attempt-row lifecycle: logAttempt at the start; recordSuccess or
  // recordFailure on completion. Both finalize calls are atomic across all three
  // affected tables (upload_attempts, clips, quota_usage), preventing the
  // pre-refactor failure mode where a mid-flight crash could leave the DB with
  // a YouTube upload that wasn't recorded (causing duplicate uploads on restart).
  //
  // System-state failures (quota / upload-limit / auth) don't fault the clip:
  // the machine pauses and the clip is reset to 'pending' on the next cycle.
  // Per-clip failures (file errors, server errors, policy rejections, network)
  // do mark the clip 'failed' and increment retry_count.
  const SYSTEM_FAILURE_CODES = new Set(["QUOTA_EXCEEDED", "UPLOAD_LIMIT_EXCEEDED", "UNAUTHORIZED"]);

  const doUpload: InnerUploadFn = async (clipId, onProgress) => {
    const attemptId = uploadsRepo.logAttempt(clipId, config.uploadCost);

    try {
      const result = await innerUpload(clipId, onProgress);
      uploadsRepo.recordSuccess({
        clipId,
        attemptId,
        youtubeId: result.youtubeId,
        quotaCost: config.uploadCost,
        datePt: scheduler.getTodayPT(),
      });
      return result;
    } catch (error: unknown) {
      const code = error instanceof UploadError ? error.code : "UNKNOWN";
      const message = error instanceof Error ? error.message : String(error);

      if (SYSTEM_FAILURE_CODES.has(code)) {
        uploadsRepo.recordSystemFailure({
          attemptId,
          clipId,
          errorMessage: message,
          errorCode: code,
        });
      } else {
        uploadsRepo.recordFailure({ clipId, attemptId, errorMessage: message, errorCode: code });
      }

      // Re-throw in the shape the XState machine expects.
      throw { error: message, code };
    }
  };

  async function getClipData(clipId: string) {
    const clip = clipsRepo.getClipsPaginated({ search: clipId, pageSize: 1 }).clips[0];
    if (!clip) return null;
    return {
      clipId: clip.clip_id,
      url: clip.url,
      embedUrl: clip.embed_url,
      broadcasterId: clip.broadcaster_id,
      broadcasterName: clip.broadcaster_name,
      creatorId: clip.creator_id,
      creatorName: clip.creator_name,
      gameId: clip.game_id,
      language: clip.language ?? "en",
      title: clip.title,
      viewCount: clip.view_count,
      createdAt: clip.created_at,
      thumbnailUrl: clip.thumbnail_url ?? "",
      clipArchived: !!clip.clip_archived,
      thumbnailArchived: !!clip.thumbnail_archived,
      deletedOnTwitch: !!clip.deleted_on_twitch,
    };
  }

  // Public API
  function start() {
    // Reset any clips stuck in "uploading" from a previous interrupted run
    clipsRepo.resetInterrupted();
    // Mark ignored clips on every start (catches existing DB entries, not just new imports)
    if (config.ignoredClipIds.length > 0) {
      clipsRepo.markIgnored(config.ignoredClipIds);
    }
    actor.start();
    actor.send({ type: "START" });
  }

  function stop() {
    actor.send({ type: "STOP" });
    actor.stop();
  }

  function pause() {
    actor.send({ type: "PAUSE" });
    engineStateRepo.setUserPaused(true);
  }

  function resume() {
    actor.send({ type: "RESUME" });
    engineStateRepo.setUserPaused(false);
  }

  function notifyAuthComplete() {
    // Machine automatically transitions to rediscovering after auth
    actor.send({ type: "AUTH_COMPLETE" });
  }

  function triggerClip(clipId: string) {
    actor.send({ type: "TRIGGER_CLIP", clipId });
  }

  function importNow() {
    actor.send({ type: "IMPORT_NOW" });
  }

  function discoverNow() {
    actor.send({ type: "DISCOVER_NOW" });
  }

  function notifyClipsChanged() {
    actor.send({ type: "CLIPS_CHANGED" });
  }

  function notifyQuotaReset() {
    actor.send({ type: "QUOTA_RESET" });
  }

  function resetFailedClips(): { reset: number } {
    const count = clipsRepo.resetFailed();
    actor.send({ type: "CLIPS_CHANGED" });
    return { reset: count };
  }

  function resetAllClips(): { reset: number } {
    const count = clipsRepo.resetAll();
    actor.send({ type: "CLIPS_CHANGED" });
    return { reset: count };
  }

  /**
   * Retry a single clip from scratch: clear sync_status / youtube_id / retry_count
   * back to pending, then nudge the machine. Returns whether any row was changed
   * (false when the clip didn't exist or was already pending).
   */
  function retryClip(clipId: string): { reset: boolean } {
    const reset = clipsRepo.resetClip(clipId);
    if (reset) actor.send({ type: "CLIPS_CHANGED" });
    return { reset };
  }

  /**
   * Apply a bulk action across many clips atomically. On 'retry', also nudges
   * the engine so the newly-pending clips get picked up immediately rather than
   * waiting for the next archive-poll tick.
   */
  function bulkClipAction(input: { action: "ignore" | "reset" | "retry"; clipIds: string[] }): {
    affected: number;
  } {
    const result = clipsRepo.bulkAction(input);
    if (result.affected > 0 && input.action !== "ignore") {
      actor.send({ type: "CLIPS_CHANGED" });
    }
    return result;
  }

  // Debug controls
  function setDebugFlag(flag: "fail" | "quota" | "uploadLimit", value: boolean) {
    const eventMap = {
      fail: "DEBUG_SET_FORCE_FAIL" as const,
      quota: "DEBUG_SET_FORCE_QUOTA" as const,
      uploadLimit: "DEBUG_SET_FORCE_UPLOAD_LIMIT" as const,
    };
    actor.send({ type: eventMap[flag], value });
  }

  function clearDebugFlags() {
    actor.send({ type: "DEBUG_CLEAR_ALL" });
  }

  function getState() {
    return getSnapshot();
  }

  function send(event: SyncEvent) {
    actor.send(event);
  }

  return {
    start,
    stop,
    pause,
    resume,
    getState,
    getSnapshot,
    notifyAuthComplete,
    triggerClip,
    importNow,
    discoverNow,
    notifyClipsChanged,
    notifyQuotaReset,
    resetFailedClips,
    resetAllClips,
    retryClip,
    bulkClipAction,
    setDebugFlag,
    clearDebugFlags,
    send,
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
