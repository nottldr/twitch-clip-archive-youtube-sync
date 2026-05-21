import { useRetryClip } from "#web/lib/mutations.js";
import { useRecentActivity } from "#web/lib/queries.js";
import { ageMs, formatTimeAgo, useTick } from "#web/lib/time.js";
import type { EngineSnapshot } from "#web/lib/types.js";

import { EmptyState } from "./ui/EmptyState.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface Props {
  engine: EngineSnapshot;
}

export function InboxSection({ engine }: Props) {
  // Relative timestamps in this section want to stay roughly fresh.
  useTick(15_000);
  const { data: activity } = useRecentActivity(30);
  const retryMutation = useRetryClip();

  const failedClips = (activity ?? []).filter((c) => c.sync_status === "failed").slice(0, 5);

  // Stalled tasks: task ran more than 24h ago (or never, if we have a nextRunAt
  // expectation that's also stale).
  const archive = engine.tasks.archiveImport;
  const quota = engine.tasks.quotaDiscovery;
  const stalled: { label: string; lastRun: string | null }[] = [];
  if (archive.lastRunAt && ageMs(archive.lastRunAt) > STALE_THRESHOLD_MS) {
    stalled.push({ label: "Archive import task", lastRun: archive.lastRunAt });
  }
  if (quota.lastRunAt && ageMs(quota.lastRunAt) > STALE_THRESHOLD_MS) {
    stalled.push({ label: "Quota discovery task", lastRun: quota.lastRunAt });
  }

  // Upstream archive silent: the engine reported `lastImportAt` is old. Distinct
  // from "task stalled" — the task may be running fine but finding no new dumps.
  const lastImportAt = engine.context.lastImportAt;
  const upstreamSilent = lastImportAt && ageMs(lastImportAt) > STALE_THRESHOLD_MS;

  const awaitingAuth = engine.state === "active.blocked.awaitingAuth";
  const nothingPending =
    !awaitingAuth && !upstreamSilent && failedClips.length === 0 && stalled.length === 0;

  if (nothingPending) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Needs attention
        </h2>
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30">
          <EmptyState
            tone="success"
            icon={<span aria-hidden="true">✓</span>}
            title="Nothing needs your attention"
            hint="No failed clips, no stalled tasks, auth is healthy."
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Needs attention
      </h2>
      <div className="divide-y rounded-lg border bg-white shadow-sm dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
        {/* AuthBanner is rendered at app-shell level when awaitingAuth, so we
            don't duplicate the full call-out here — but we surface a one-liner
            so the inbox tells the whole story. */}
        {awaitingAuth && (
          <div className="px-3 py-2 text-sm">
            <span className="font-medium">YouTube auth is required.</span>{" "}
            <a href="/api/oauth/connect" className="text-blue-600 hover:underline">
              Reconnect
            </a>
          </div>
        )}

        {upstreamSilent && lastImportAt && (
          <div className="px-3 py-2 text-sm">
            <span className="font-medium">No new archive content</span>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              last import {formatTimeAgo(lastImportAt)} — check that the twitch-clip-archive tool is
              still running.
            </span>
          </div>
        )}

        {stalled.map((task) => (
          <div key={task.label} className="px-3 py-2 text-sm">
            <span className="font-medium">{task.label} hasn&apos;t run recently</span>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              last ran {task.lastRun ? formatTimeAgo(task.lastRun) : "never"}
            </span>
          </div>
        ))}

        {failedClips.map((clip) => (
          <div
            key={clip.clip_id}
            className="flex items-start justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="min-w-0 flex-1">
              <div
                className="truncate font-medium text-gray-800 dark:text-gray-100"
                title={clip.title}
              >
                {clip.title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800 dark:bg-red-900 dark:text-red-100">
                  failed
                </span>
                {clip.last_error && (
                  <span
                    className="min-w-0 truncate font-mono text-red-600 dark:text-red-300"
                    title={clip.last_error}
                  >
                    {clip.last_error}
                  </span>
                )}
                <span className="shrink-0 text-gray-500 dark:text-gray-400">
                  {formatTimeAgo(clip.updated_at)}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                retryMutation.mutate(clip.clip_id);
              }}
              disabled={retryMutation.isPending}
              className="shrink-0 rounded border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Retry
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
