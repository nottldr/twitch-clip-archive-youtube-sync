import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { fetchJson } from "#web/lib/api.js";
import { ClipDetailSchema, type UploadAttemptRow } from "#web/lib/types.js";

import { StatusBadge } from "./StatusBadge.js";

interface Props {
  clipId: string | null;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
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
        <div className="mt-1 text-red-600 dark:text-red-400">
          <span className="font-mono">{attempt.error_code}</span>
          {attempt.error_message && `: ${attempt.error_message}`}
        </div>
      )}
    </li>
  );
}

export function ClipDetailDrawer({ clipId, onClose }: Props) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    enabled: !!clipId,
    queryKey: ["clips", clipId],
    queryFn: () => fetchJson(`/api/clips/${clipId}`, ClipDetailSchema),
  });

  // Keep the drawer in sync with SSE-driven refetches of the clips list.
  useEffect(() => {
    if (clipId) void refetch();
  }, [clipId, refetch]);

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clips/${clipId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(`Retry failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void refetch();
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/clips/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ignore", clipIds: [clipId] }),
      });
      if (!res.ok) throw new Error(`Ignore failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void refetch();
    },
  });

  if (!clipId) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white shadow-xl sm:max-w-lg dark:bg-gray-800"
        role="dialog"
        aria-label="Clip details"
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="truncate font-semibold text-gray-800 dark:text-gray-100">
            {data?.clip.title ?? clipId}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="Close detail drawer"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="p-4 text-gray-400">Loading…</div>
        ) : !data ? (
          <div className="p-4 text-red-500">Clip not found</div>
        ) : (
          <div className="space-y-4 p-4 text-sm">
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
                <a
                  href={`https://youtu.be/${data.clip.youtube_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border px-2 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  YouTube ↗
                </a>
              )}
              <button
                onClick={() => {
                  retryMutation.mutate();
                }}
                disabled={retryMutation.isPending}
                className="rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                {retryMutation.isPending ? "Retrying…" : "Retry from scratch"}
              </button>
              {data.clip.sync_status !== "ignored" && (
                <button
                  onClick={() => {
                    ignoreMutation.mutate();
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
                Attempt history ({data.attempts.length}
                {data.attemptsHasMore ? "+" : ""})
              </h3>
              {data.attempts.length === 0 ? (
                <p className="text-xs text-gray-400">No attempts yet.</p>
              ) : (
                <ul className="border-t dark:border-gray-700">
                  {data.attempts.map((a) => (
                    <AttemptRow key={a.id} attempt={a} />
                  ))}
                </ul>
              )}
            </section>

            {data.logs.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  Activity log
                </h3>
                <ul className="space-y-1 text-xs">
                  {data.logs.map((log) => (
                    <li
                      key={log.id}
                      className="border-l-2 border-gray-200 pl-2 dark:border-gray-700"
                    >
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
        )}
      </aside>
    </>
  );
}
