import type { Scheduler } from "./scheduler.js";

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readLatestDump } from "#server/archive/reader.js";
import type { Config } from "#server/config.js";
import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { UploadsRepository } from "#server/db/repositories/uploads.js";
import type { AuthManager } from "#server/youtube/auth.js";
import { UploadError, uploadClip } from "#server/youtube/uploader.js";

export type EngineStatus = "running" | "idle" | "paused" | "error" | "stopped";

export interface EngineEventHandler {
  onUploadSuccess(clipId: string, youtubeId: string): void;
  onUploadFailure(clipId: string, error: string): void;
  onQuotaExhausted(): void;
  onSyncError(error: string): void;
  onStatusChange(status: EngineStatus): void;
  onAuthComplete(): void;
}

const noopHandler: EngineEventHandler = {
  onUploadSuccess: () => {},
  onUploadFailure: () => {},
  onQuotaExhausted: () => {},
  onSyncError: () => {},
  onStatusChange: () => {},
  onAuthComplete: () => {},
};

export function createSyncEngine(
  config: Config,
  clipsRepo: ClipsRepository,
  uploadsRepo: UploadsRepository,
  scheduler: Scheduler,
  authManager: AuthManager,
  eventHandler: EngineEventHandler = noopHandler,
) {
  let status: EngineStatus = "idle";
  let running = false;
  let userPaused = false;
  let pauseReason: "quota" | "upload-limit" | null = null;
  let currentUploadClipId: string | null = null;
  let loopTimeout: ReturnType<typeof setTimeout> | null = null;
  let archivePollTimeout: ReturnType<typeof setTimeout> | null = null;
  const lockPath = resolve(config.dataPath, "engine.lock");

  function getStatus(): EngineStatus {
    return status;
  }

  function getSyncMode(): "auto" | "manual" {
    return config.syncMode;
  }

  function setStatus(newStatus: EngineStatus): void {
    if (status !== newStatus) {
      status = newStatus;
      eventHandler.onStatusChange(status);
    }
  }

  function acquireLock(): boolean {
    if (existsSync(lockPath)) {
      const existingPid = readFileSync(lockPath, "utf-8").trim();
      // Check if the process is still running
      try {
        process.kill(Number.parseInt(existingPid, 10), 0);
        // Process exists, lock is held
        return false;
      } catch {
        // Process doesn't exist, stale lock
      }
    }
    writeFileSync(lockPath, String(process.pid));
    return true;
  }

  function releaseLock(): void {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already cleaned up
    }
  }

  function importArchive(): number {
    const clips = readLatestDump(config.archivePath);
    if (clips.length === 0) {
      eventHandler.onSyncError(`No clips found in archive at ${config.archivePath}`);
      return 0;
    }
    const newCount = clipsRepo.upsertFromArchive(clips);
    return newCount;
  }

  async function processNextClip(): Promise<boolean> {
    if (userPaused) return false;

    // Check quota
    if (!scheduler.canUpload()) {
      setStatus("paused");
      eventHandler.onQuotaExhausted();
      return false;
    }

    // Get next pending clip
    const clip = clipsRepo.getNextPending() ?? clipsRepo.getNextRetryable(config.maxRetryCount);
    if (!clip) {
      return false; // Nothing to process
    }

    // Verify file exists and is > 1KB
    const mp4Path = resolve(config.archivePath, "media/clips", `${clip.clip_id}.mp4`);
    try {
      const stat = statSync(mp4Path);
      if (stat.size < 1024) {
        const reason = `MP4 too small (${stat.size} bytes)`;
        clipsRepo.markSkipped(clip.clip_id, reason);
        eventHandler.onUploadFailure(clip.clip_id, reason);
        return true;
      }
    } catch {
      clipsRepo.markSkipped(clip.clip_id, "MP4 file not found");
      eventHandler.onUploadFailure(clip.clip_id, "MP4 file not found");
      return true;
    }

    // Mark as uploading (only one upload at a time, sequential processing)
    clipsRepo.markUploading(clip.clip_id);
    currentUploadClipId = clip.clip_id;

    if (config.dryRun) {
      const fakeId = `dry-run-${randomUUID().slice(0, 8)}`;
      clipsRepo.markUploaded(clip.clip_id, fakeId);
      scheduler.recordUpload();
      currentUploadClipId = null;
      eventHandler.onUploadSuccess(clip.clip_id, fakeId);
      return true;
    }

    // Real upload
    try {
      const youtube = await authManager.getAuthenticatedClient();
      if (!youtube) {
        // Not authenticated, don't mark the clip as failed (it's not the clip's fault).
        // Just go idle and wait for auth.
        setStatus("idle");
        eventHandler.onSyncError("Not authenticated, waiting for OAuth connection");
        return false;
      }

      const twitchClip = {
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

      const result = await uploadClip(
        twitchClip,
        config.archivePath,
        youtube,
        uploadsRepo,
        config.uploadCost,
        config.descriptionTemplate,
      );

      clipsRepo.markUploaded(clip.clip_id, result.youtubeId);
      scheduler.recordUpload();
      currentUploadClipId = null;
      eventHandler.onUploadSuccess(clip.clip_id, result.youtubeId);
      return true;
    } catch (error) {
      currentUploadClipId = null;
      if (error instanceof UploadError) {
        if (error.code === "QUOTA_EXCEEDED") {
          clipsRepo.resetInterrupted();
          setStatus("paused");
          pauseReason = "quota";
          eventHandler.onQuotaExhausted();
          return false;
        }

        if (error.code === "UPLOAD_LIMIT_EXCEEDED") {
          clipsRepo.resetInterrupted();
          setStatus("paused");
          pauseReason = "upload-limit";
          eventHandler.onSyncError("YouTube daily upload limit reached, retrying in 1 hour");
          return false;
        }

        clipsRepo.markFailed(clip.clip_id, `${error.code}: ${error.message}`);
        eventHandler.onUploadFailure(clip.clip_id, error.message);
        return true; // Continue with next clip
      }

      const message = error instanceof Error ? error.message : String(error);
      clipsRepo.markFailed(clip.clip_id, message);
      eventHandler.onUploadFailure(clip.clip_id, message);
      return true;
    }
  }

  async function runLoop(): Promise<void> {
    if (!running) return;

    try {
      const processed = await processNextClip();

      if (!processed) {
        if (status === "paused") {
          const sleepMs =
            pauseReason === "upload-limit"
              ? 60 * 60 * 1000 // 1 hour for upload limit
              : scheduler.msUntilQuotaReset(); // midnight PT for quota
          pauseReason = null;
          loopTimeout = setTimeout(
            () => {
              setStatus("running");
              void runLoop();
            },
            Math.min(sleepMs, 60_000),
          );
          return;
        }

        // Nothing to process, check again after a short delay
        loopTimeout = setTimeout(() => void runLoop(), 30_000);
        return;
      }

      // Processed successfully, continue after interval
      setStatus("running");
      loopTimeout = setTimeout(() => void runLoop(), config.uploadIntervalMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventHandler.onSyncError(message);
      setStatus("error");
      // Retry after a delay
      loopTimeout = setTimeout(() => void runLoop(), 60_000);
    }
  }

  function startArchivePolling(): void {
    archivePollTimeout = setInterval(() => {
      try {
        importArchive();
      } catch {
        // Log but don't crash
      }
    }, config.archivePollIntervalMs);
  }

  async function start(): Promise<void> {
    if (running) return;

    if (!acquireLock()) {
      throw new Error("Another instance is already running (engine.lock held by active process)");
    }

    running = true;

    // Reset interrupted uploads
    clipsRepo.resetInterrupted();

    // Initial archive import
    importArchive();

    // Check auth
    if (!authManager.isAuthenticated()) {
      setStatus("idle");
      // Will be woken up by notifyAuthComplete()
    } else if (config.syncMode === "manual") {
      setStatus("idle");
      // Manual mode: wait for trigger via API
    } else {
      setStatus("running");
      void runLoop();
    }

    startArchivePolling();
  }

  function notifyAuthComplete(): void {
    eventHandler.onAuthComplete();
    if (status === "idle" && running && config.syncMode !== "manual") {
      setStatus("running");
      if (loopTimeout) clearTimeout(loopTimeout);
      void runLoop();
    }
  }

  /** Manually trigger a single upload (for manual sync mode). */
  async function triggerUpload(): Promise<{ processed: boolean; status: string }> {
    if (!authManager.isAuthenticated()) {
      return { processed: false, status: "not authenticated" };
    }
    const processed = await processNextClip();
    return { processed, status: getStatus() };
  }

  /** Reset only failed/skipped clips back to pending. */
  function resetFailedClips(): { reset: number } {
    return { reset: clipsRepo.resetFailed() };
  }

  /** Reset ALL non-pending clips back to pending (including uploaded). */
  function resetAllClips(): { reset: number } {
    return { reset: clipsRepo.resetAll() };
  }

  async function stop(): Promise<void> {
    running = false;
    setStatus("stopped");

    if (loopTimeout) {
      clearTimeout(loopTimeout);
      loopTimeout = null;
    }
    if (archivePollTimeout) {
      clearInterval(archivePollTimeout);
      archivePollTimeout = null;
    }

    releaseLock();
  }

  function pause(): void {
    userPaused = true;
    if (loopTimeout) {
      clearTimeout(loopTimeout);
      loopTimeout = null;
    }
    setStatus("paused");
  }

  function resume(): void {
    userPaused = false;
    if (running && authManager.isAuthenticated() && config.syncMode !== "manual") {
      setStatus("running");
      void runLoop();
    }
  }

  function isPaused(): boolean {
    return userPaused;
  }

  function getCurrentUpload(): string | null {
    return currentUploadClipId;
  }

  return {
    start,
    stop,
    getStatus,
    getSyncMode,
    notifyAuthComplete,
    importArchive,
    triggerUpload,
    resetFailedClips,
    resetAllClips,
    processNextClip,
    pause,
    resume,
    isPaused,
    getCurrentUpload,
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
