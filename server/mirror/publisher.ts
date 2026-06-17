import { Temporal } from "@js-temporal/polyfill";

import type { ClipsRepository } from "#server/db/repositories/clips.js";
import type { MirrorPublishesRepository } from "#server/db/repositories/mirror-publishes.js";
import { createLogger } from "#server/logger.js";

import { buildSnapshot } from "./builder.js";
import { type MirrorRepoConfig, publishFiles } from "./github.js";

const logger = createLogger("mirror");

const PUBLISH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type MirrorConfig = MirrorRepoConfig | null;

export interface PublishOutcome {
  ok: boolean;
  clipCount: number;
  commitSha: string | null;
  generatedAt: string;
  error?: string;
}

export interface PublisherDeps {
  config: MirrorConfig;
  clipsRepo: ClipsRepository;
  mirrorRepo: MirrorPublishesRepository;
}

/**
 * Build a snapshot and push both files to the mirror repo. Idempotent —
 * back-to-back calls just create two commits with the same payload (which
 * GitHub coalesces into one if content is unchanged). Records success or
 * failure in `mirror_publishes` for the Diagnostics panel to surface.
 */
export async function publishNow(deps: PublisherDeps): Promise<PublishOutcome> {
  if (!deps.config) {
    return {
      ok: false,
      clipCount: 0,
      commitSha: null,
      generatedAt: Temporal.Now.instant().toString(),
      error: "Mirror not configured (MIRROR_GITHUB_TOKEN unset)",
    };
  }
  const cfg = deps.config;

  const snapshot = buildSnapshot(deps.clipsRepo);
  const commitMessage = `mirror: snapshot @ ${snapshot.manifest.generated_at} (${String(snapshot.manifest.clip_count)} clips)`;

  try {
    // Atomic: one tree, one commit covering both files. Consumers fetching
    // mid-publish see either both old files or both new files, never one of
    // each. base_tree inheritance preserves anything else in the repo (README,
    // .gitignore, etc.).
    const sha = await publishFiles(
      cfg,
      [
        { path: "clips.json", content: snapshot.clipsJson },
        { path: "manifest.json", content: snapshot.manifestJson },
      ],
      commitMessage,
    );

    deps.mirrorRepo.recordSuccess({
      clipCount: snapshot.manifest.clip_count,
      commitSha: sha,
    });
    logger.info(
      { clipCount: snapshot.manifest.clip_count, commitSha: sha },
      "Mirror snapshot published",
    );

    return {
      ok: true,
      clipCount: snapshot.manifest.clip_count,
      commitSha: sha,
      generatedAt: snapshot.manifest.generated_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.mirrorRepo.recordFailure({
      errorMessage: message,
      clipCount: snapshot.manifest.clip_count,
    });
    logger.error({ error }, "Mirror snapshot publish failed");
    return {
      ok: false,
      clipCount: snapshot.manifest.clip_count,
      commitSha: null,
      generatedAt: snapshot.manifest.generated_at,
      error: message,
    };
  }
}

/**
 * Daily scheduler: fires immediately on startup if no successful publish has
 * ever happened, otherwise waits until 24h after the last successful publish.
 * After that, ticks every 24h. Returns a stop() for graceful shutdown / tests.
 */
export function startMirrorScheduler(deps: PublisherDeps): { stop: () => void } {
  if (!deps.config) {
    logger.warn(
      "MIRROR_GITHUB_TOKEN not set — mirror publisher disabled (diagnostics button will return 503)",
    );
    return {
      stop: () => {
        // No-op when disabled.
      },
    };
  }

  const last = deps.mirrorRepo.lastSuccess();
  let firstDelay = 0;
  if (last?.succeeded_at) {
    const lastInstant = Temporal.Instant.from(
      last.succeeded_at.includes("T")
        ? last.succeeded_at
        : `${last.succeeded_at.replace(" ", "T")}Z`,
    );
    const dueAt = lastInstant.add({ milliseconds: PUBLISH_INTERVAL_MS });
    const now = Temporal.Now.instant();
    const remaining = dueAt.epochMilliseconds - now.epochMilliseconds;
    firstDelay = Math.max(0, remaining);
  }

  let stopped = false;
  let timer: NodeJS.Timeout;

  function tick(): void {
    if (stopped) return;
    void publishNow(deps).finally(() => {
      if (stopped) return;
      timer = setTimeout(tick, PUBLISH_INTERVAL_MS);
      timer.unref();
    });
  }

  timer = setTimeout(tick, firstDelay);
  timer.unref();

  logger.info(
    { firstDelayMs: firstDelay, intervalMs: PUBLISH_INTERVAL_MS },
    "Mirror publisher scheduled",
  );

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export function nextDueAt(
  mirrorRepo: MirrorPublishesRepository,
  configured: boolean,
): string | null {
  if (!configured) return null;
  const last = mirrorRepo.lastSuccess();
  if (!last?.succeeded_at) return Temporal.Now.instant().toString();
  const lastInstant = Temporal.Instant.from(
    last.succeeded_at.includes("T") ? last.succeeded_at : `${last.succeeded_at.replace(" ", "T")}Z`,
  );
  return lastInstant.add({ milliseconds: PUBLISH_INTERVAL_MS }).toString();
}
