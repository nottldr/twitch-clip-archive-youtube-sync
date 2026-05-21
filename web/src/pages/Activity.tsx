import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ActivityRow, type FeedItem } from "#web/components/ActivityRow.js";
import { LiveFeed } from "#web/components/LiveFeed.js";
import {
  type TimeRange,
  TimeRangeFilter,
  timeRangeToSince,
} from "#web/components/TimeRangeFilter.js";
import { FilterChips } from "#web/components/ui/FilterChips.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton } from "#web/components/ui/Skeleton.js";
import { Toolbar } from "#web/components/ui/Toolbar.js";
import { useLiveBuffer } from "#web/hooks/use-live-buffer.js";
import { fetchJson } from "#web/lib/api.js";
import { type LogEntry, PaginatedLogsSchema } from "#web/lib/types.js";

const LOG_TYPES = ["state_change", "upload", "error"] as const;

const ERROR_CODE_OPTIONS = [
  "QUOTA_EXCEEDED",
  "UPLOAD_LIMIT_EXCEEDED",
  "UNAUTHORIZED",
  "REJECTED",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "BAD_REQUEST",
  "FILE_NOT_FOUND",
  "FILE_TOO_SMALL",
] as const;

async function fetchLogs(input: {
  types: string[];
  limit: number;
  beforeId?: number;
  clipId?: string;
  since?: string;
  errorCode?: string;
}) {
  const sp = new URLSearchParams();
  if (input.types.length > 0 && input.types.length < LOG_TYPES.length) {
    sp.set("type", input.types.join(","));
  }
  sp.set("limit", String(input.limit));
  if (input.beforeId) sp.set("before", String(input.beforeId));
  if (input.clipId) sp.set("clipId", input.clipId);
  if (input.since) sp.set("since", input.since);
  if (input.errorCode) sp.set("errorCode", input.errorCode);
  return fetchJson(`/api/logs?${sp.toString()}`, PaginatedLogsSchema);
}

/**
 * Pull the leading "CODE: " out of an engine_log `error` field. Engine writes
 * errors as `${code}: ${message}` (see uploads.ts:132). Returns null when the
 * shape doesn't match — we don't want to render a chip for free-form errors.
 */
function extractErrorCode(error: string | null): string | null {
  if (!error) return null;
  const m = /^([A-Z][A-Z_]{2,})(?::\s|$)/.exec(error);
  return m ? m[1] : null;
}

function logToFeedItem(entry: LogEntry): FeedItem {
  return {
    id: `log-${entry.id.toString()}`,
    timestamp: entry.timestamp,
    type: entry.type,
    message: entry.message,
    clipId: entry.clipId,
    youtubeId: entry.youtubeId,
    errorCode: extractErrorCode(entry.error),
  };
}

export function Activity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialClipId = searchParams.get("clipId") ?? "";
  const [clipFilter, setClipFilter] = useState(initialClipId);
  const [selectedTypes, setSelectedTypes] = useState(new Set<string>(LOG_TYPES));
  const [errorCode, setErrorCode] = useState("");
  const [range, setRange] = useState<TimeRange>("all");
  const liveBuffer = useLiveBuffer();

  const typeArray = [...selectedTypes];
  const since = timeRangeToSince(range);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["logs", typeArray.join(","), clipFilter, errorCode, range],
    queryFn: ({ pageParam }) =>
      fetchLogs({
        types: typeArray,
        limit: 50,
        beforeId: pageParam,
        clipId: clipFilter || undefined,
        errorCode: errorCode || undefined,
        since: since ?? undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.entries.length === 0) return;
      return lastPage.entries.at(-1)?.id;
    },
  });

  const auditItems = useMemo<FeedItem[]>(
    () => data?.pages.flatMap((p) => p.entries.map(logToFeedItem)) ?? [],
    [data],
  );

  function toggleType(type: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function clearClipFilter() {
    setClipFilter("");
    searchParams.delete("clipId");
    setSearchParams(searchParams);
  }

  // Apply the same filters to the live feed so the two regions don't disagree.
  const filteredLive = useMemo(() => {
    return liveBuffer.items.filter((item) => {
      if (!selectedTypes.has(item.type)) return false;
      if (clipFilter && item.clipId !== clipFilter) return false;
      if (errorCode && item.errorCode !== errorCode) return false;
      // Live items are by definition recent — range filter does nothing here.
      return true;
    });
  }, [liveBuffer.items, selectedTypes, clipFilter, errorCode]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity"
        subtitle="Live SSE events at the top; queryable audit log below."
      />

      <Toolbar
        start={
          <>
            <FilterChips
              options={LOG_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))}
              selected={new Set(selectedTypes)}
              onToggle={toggleType}
            />
            <TimeRangeFilter value={range} onChange={setRange} />
            <select
              value={errorCode}
              onChange={(e) => {
                setErrorCode(e.target.value);
              }}
              className="rounded border px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">All error codes</option>
              {ERROR_CODE_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {clipFilter && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-100">
                clip: <span className="font-mono">{clipFilter}</span>
                <button
                  type="button"
                  onClick={clearClipFilter}
                  className="ml-1 hover:underline"
                  aria-label="Clear clip filter"
                >
                  ✕
                </button>
              </span>
            )}
          </>
        }
      />

      <LiveFeed
        items={filteredLive}
        paused={liveBuffer.paused}
        pendingCount={liveBuffer.pendingCount}
        onTogglePause={liveBuffer.togglePause}
        onFlushPending={liveBuffer.flushPending}
        onClear={liveBuffer.clear}
      />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Audit log</h2>
        <div className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-6 w-1/3" />
              <div className="mt-3 space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            </div>
          ) : auditItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No log entries match these filters.
            </div>
          ) : (
            <div className="divide-y dark:divide-gray-700">
              {auditItems.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
          {hasNextPage && (
            <div className="border-t px-4 py-3 text-center dark:border-gray-700">
              <button
                onClick={() => {
                  void fetchNextPage();
                }}
                disabled={isFetchingNextPage}
                className="rounded border px-4 py-1 text-sm hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
