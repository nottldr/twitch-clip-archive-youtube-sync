import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

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
import { useLogsInfinite } from "#web/lib/queries.js";
import type { LogEntry } from "#web/lib/types.js";

const LOG_TYPES = ["state_change", "upload", "error"] as const;
type LogType = (typeof LOG_TYPES)[number];

const KNOWN_ERROR_CODES = [
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

const KNOWN_ERROR_CODE_SET = new Set<string>(KNOWN_ERROR_CODES);

/**
 * Pull the leading "CODE: " out of an engine_log `error` field. Engine writes
 * errors as `${code}: ${message}` (see uploads.ts:132); we only render a chip
 * when the leading token is one of our 10 canonical codes — anything else is
 * left as plain message text so we don't accidentally turn a free-form string
 * into a fake "chip".
 */
function extractErrorCode(error: string | null): string | null {
  if (!error) return null;
  const colonIdx = error.indexOf(":");
  const head = (colonIdx === -1 ? error : error.slice(0, colonIdx)).trim();
  return KNOWN_ERROR_CODE_SET.has(head) ? head : null;
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
  const search = useSearch({ from: "/activity" });
  const navigate = useNavigate({ from: "/activity" });
  const liveBuffer = useLiveBuffer();

  const selectedTypes = useMemo<Set<string>>(
    () => new Set(search.type ?? LOG_TYPES),
    [search.type],
  );

  const since = timeRangeToSince(search.range);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useLogsInfinite({
    types: [...selectedTypes],
    totalTypes: LOG_TYPES.length,
    clipId: search.clipId || undefined,
    errorCode: search.errorCode || undefined,
    since,
  });

  const auditItems = useMemo<FeedItem[]>(
    () => data?.pages.flatMap((p) => p.entries.map(logToFeedItem)) ?? [],
    [data],
  );

  function isLogType(value: string): value is LogType {
    switch (value) {
      case "state_change":
      case "upload":
      case "error":
        return true;
      default:
        return false;
    }
  }

  function toggleType(type: string) {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    const arr = [...next].filter(isLogType);
    void navigate({
      search: (prev) => ({
        ...prev,
        type: arr.length === LOG_TYPES.length ? undefined : arr,
      }),
    });
  }

  function clearClipFilter() {
    void navigate({ search: (prev) => ({ ...prev, clipId: "" }) });
  }

  // Apply the same filters to the live feed so the two regions don't disagree.
  const filteredLive = useMemo(() => {
    return liveBuffer.items.filter((item) => {
      if (!selectedTypes.has(item.type)) return false;
      if (search.clipId && item.clipId !== search.clipId) return false;
      if (search.errorCode && item.errorCode !== search.errorCode) return false;
      // Live items are by definition recent — range filter does nothing here.
      return true;
    });
  }, [liveBuffer.items, selectedTypes, search.clipId, search.errorCode]);

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
            <TimeRangeFilter
              value={search.range}
              onChange={(range: TimeRange) => {
                void navigate({ search: (prev) => ({ ...prev, range }) });
              }}
            />
            <select
              value={search.errorCode}
              onChange={(e) => {
                const value = e.target.value;
                void navigate({ search: (prev) => ({ ...prev, errorCode: value }) });
              }}
              className="rounded border px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">All error codes</option>
              {KNOWN_ERROR_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {search.clipId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-100">
                clip: <span className="font-mono">{search.clipId}</span>
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
