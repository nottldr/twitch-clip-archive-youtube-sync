import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusBadge } from "#web/components/StatusBadge.js";
import type { LogEntry } from "#web/lib/types.js";

const LOG_TYPES = ["state_change", "upload", "error"] as const;

interface LogResponse {
  entries: LogEntry[];
  hasMore: boolean;
}

async function fetchLogs(params: {
  types: string[];
  limit: number;
  beforeId?: number;
}): Promise<LogResponse> {
  const searchParams = new URLSearchParams();
  if (params.types.length > 0 && params.types.length < LOG_TYPES.length) {
    searchParams.set("type", params.types.join(","));
  }
  searchParams.set("limit", String(params.limit));
  if (params.beforeId) {
    searchParams.set("before", String(params.beforeId));
  }

  const res = await fetch(`/api/logs?${searchParams}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function Logs() {
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(LOG_TYPES));

  const typeArray = [...selectedTypes];

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["logs", typeArray.join(",")],
    queryFn: ({ pageParam }) =>
      fetchLogs({
        types: typeArray,
        limit: 50,
        beforeId: pageParam,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.entries.length === 0) return;
      return lastPage.entries.at(-1)?.id;
    },
  });

  function toggleType(type: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  const allEntries = data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Logs</h1>

      <div className="flex flex-wrap items-center gap-3">
        {LOG_TYPES.map((type) => (
          <label key={type} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selectedTypes.has(type)}
              onChange={() => {
                toggleType(type);
              }}
              className="rounded"
            />
            <span>{type.replaceAll("_", " ")}</span>
          </label>
        ))}
      </div>

      <div className="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        {isLoading ? (
          <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>
        ) : allEntries.length === 0 ? (
          <div className="p-8 text-gray-400 dark:text-gray-500">No log entries.</div>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {allEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <StatusBadge status={entry.type} />
                <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">
                  {entry.message}
                </span>
              </div>
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
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
