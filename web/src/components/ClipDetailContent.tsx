import { useState } from "react";
import { z } from "zod/v4";

import { ErrorCodeChip } from "#web/components/ui/ErrorCodeChip.js";
import { fetchJson } from "#web/lib/api.js";
import { useForceUploadClip, useMarkIgnored, useRetryClip } from "#web/lib/mutations.js";
import {
  formatDateTime as fmtDateTime,
  formatDuration as fmtDuration,
  parseInstant,
} from "#web/lib/time.js";
import { type ClipDetail, type UploadAttemptRow, UploadAttemptRowSchema } from "#web/lib/types.js";

import { StatusBadge } from "./StatusBadge.js";

const AttemptsPageSchema = z.object({
  attempts: z.array(UploadAttemptRowSchema),
  hasMore: z.boolean(),
});

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return fmtDateTime(iso);
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = parseInstant(completedAt)
    .since(parseInstant(startedAt))
    .total({ unit: "millisecond" });
  return fmtDuration(ms);
}

function AttemptRow({ attempt }: { attempt: UploadAttemptRow }) {
  const success = attempt.success === 1;
  return (
    <li className="border-b py-2 text-xs dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
            success
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
              : attempt.completed_at
                ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
          }`}
        >
          {success ? "Success" : attempt.completed_at ? "Failed" : "In flight"}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {formatDateTime(attempt.started_at)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-gray-600 dark:text-gray-300">
        <span>Duration: {formatDuration(attempt.started_at, attempt.completed_at)}</span>
        <span>Quota cost: {attempt.quota_cost}</span>
        {success && attempt.youtube_id && (
          <a
            href={`https://youtu.be/${attempt.youtube_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {attempt.youtube_id}
          </a>
        )}
      </div>
      {!success && attempt.error_code && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ErrorCodeChip code={attempt.error_code} />
          {attempt.error_message && (
            <span className="font-mono text-red-600 dark:text-red-400">
              {attempt.error_message}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

interface Props {
  clipId: string;
  data: ClipDetail;
  /**
   * When true, the page can load more attempts via /api/clips/:id/attempts. The
   * drawer hides this affordance to keep its footprint small; the full-page
   * variant enables it.
   */
  enableLoadMoreAttempts?: boolean;
}

export function ClipDetailContent({ clipId, data, enableLoadMoreAttempts }: Props) {
  const retryMutation = useRetryClip();
  const forceMutation = useForceUploadClip();
  const ignoreMutation = useMarkIgnored();

  const [extraAttempts, setExtraAttempts] = useState<UploadAttemptRow[]>([]);
  const [hasMore, setHasMore] = useState(data.attemptsHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMoreAttempts() {
    const visibleAttempts = [...data.attempts, ...extraAttempts];
    const lastId = visibleAttempts.at(-1)?.id;
    if (!lastId) return;
    setLoadingMore(true);
    try {
      const page = await fetchJson(
        `/api/clips/${clipId}/attempts?limit=50&before=${String(lastId)}`,
        AttemptsPageSchema,
      );
      setExtraAttempts((prev) => [...prev, ...page.attempts]);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  const allAttempts = [...data.attempts, ...extraAttempts];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <StatusBadge status={data.clip.sync_status} />
        {data.clip.retry_count > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.clip.retry_count} retries
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-gray-500">Clip ID</dt>
        <dd className="font-mono">
          <button
            onClick={() => void navigator.clipboard.writeText(data.clip.clip_id)}
            className="hover:underline"
            title="Copy clip ID"
          >
            {data.clip.clip_id}
          </button>
        </dd>
        <dt className="text-gray-500">Broadcaster</dt>
        <dd>{data.clip.broadcaster_name}</dd>
        <dt className="text-gray-500">Creator</dt>
        <dd>{data.clip.creator_name}</dd>
        <dt className="text-gray-500">Created</dt>
        <dd>{formatDateTime(data.clip.created_at)}</dd>
        <dt className="text-gray-500">Views</dt>
        <dd>{data.clip.view_count.toLocaleString()}</dd>
        {data.clip.language && (
          <>
            <dt className="text-gray-500">Language</dt>
            <dd>{data.clip.language}</dd>
          </>
        )}
        {data.clip.uploaded_at && (
          <>
            <dt className="text-gray-500">Uploaded</dt>
            <dd>{formatDateTime(data.clip.uploaded_at)}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href={data.clip.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border px-2 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
        >
          Twitch ↗
        </a>
        {data.clip.youtube_id && (
          <>
            <a
              href={`https://youtu.be/${data.clip.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border px-2 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              YouTube ↗
            </a>
            <a
              href={`https://studio.youtube.com/video/${data.clip.youtube_id}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this video in YouTube Studio to edit metadata"
              className="rounded border px-2 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              YouTube Studio ↗
            </a>
          </>
        )}
        <button
          onClick={() => {
            retryMutation.mutate(clipId);
          }}
          disabled={retryMutation.isPending}
          className="rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
        >
          {retryMutation.isPending ? "Retrying…" : "Retry from scratch"}
        </button>
        <button
          onClick={() => {
            forceMutation.mutate(clipId);
          }}
          disabled={forceMutation.isPending}
          title="Upload this clip right now, ignoring quota / pause / auth state"
          className="rounded border border-orange-300 px-2 py-1 text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-900/40"
        >
          {forceMutation.isPending ? "Triggering…" : "Force upload now"}
        </button>
        {data.clip.sync_status !== "ignored" && (
          <button
            onClick={() => {
              ignoreMutation.mutate(clipId);
            }}
            disabled={ignoreMutation.isPending}
            className="rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            Mark ignored
          </button>
        )}
      </div>

      {data.clip.last_error && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-200">
          <div className="font-medium">Most recent error</div>
          <div className="mt-1 font-mono break-words">{data.clip.last_error}</div>
        </div>
      )}

      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Attempt history ({allAttempts.length}
          {hasMore ? "+" : ""})
        </h3>
        {allAttempts.length === 0 ? (
          <p className="text-xs text-gray-400">No attempts yet.</p>
        ) : (
          <>
            <ul className="border-t dark:border-gray-700">
              {allAttempts.map((a) => (
                <AttemptRow key={a.id} attempt={a} />
              ))}
            </ul>
            {enableLoadMoreAttempts && hasMore && (
              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={() => void loadMoreAttempts()}
                  disabled={loadingMore}
                  className="rounded border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {data.logs.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
            Activity log
          </h3>
          <ul className="space-y-1 text-xs">
            {data.logs.map((log) => (
              <li key={log.id} className="border-l-2 border-gray-200 pl-2 dark:border-gray-700">
                <span className="text-gray-500 dark:text-gray-400">
                  {formatDateTime(log.timestamp)}
                </span>{" "}
                <span className="text-gray-700 dark:text-gray-200">{log.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
