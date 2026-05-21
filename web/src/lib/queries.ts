import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { fetchJson } from "#web/lib/api.js";
import {
  ClipDetailSchema,
  DashboardStatsSchema,
  DebugFlagsSchema,
  EngineSnapshotSchema,
  OAuthStatusSchema,
  PaginatedClipsSchema,
  PaginatedLogsSchema,
  QuotaHistorySchema,
  RecentActivitySchema,
} from "#web/lib/types.js";

/**
 * Single source of truth for TanStack Query keys and query functions. Each
 * surface (Overview, Queue, Activity, Diagnostics, drawer, detail page) reads
 * the same data through these hooks — so the query key vocabulary stays
 * consistent for the SSE-driven invalidator in sse-context.tsx, and there's
 * exactly one place to change a URL or schema if the backend evolves.
 */

export const queryKeys = {
  stats: ["stats"] as const,
  engineSnapshot: ["engine", "status"] as const,
  oauthStatus: ["oauth", "status"] as const,
  debugFlags: ["debug", "flags"] as const,
  quotaHistory: (days: number) => ["quota", "history", days] as const,
  recentActivity: (limit: number) => ["activity", "recent", limit] as const,
  clipsList: (params: {
    page: number;
    statusParam: string;
    search: string;
    sortBy: string;
    sortOrder: string;
  }) => ["clips", params.page, params.statusParam, params.search, params.sortBy, params.sortOrder],
  clipDetail: (clipId: string | null | undefined) => ["clips", clipId] as const,
  logs: (params: { types: string; clipId: string; errorCode: string; range: string }) => [
    "logs",
    params.types,
    params.clipId,
    params.errorCode,
    params.range,
  ],
};

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });
}

export function useEngineSnapshot(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.engineSnapshot,
    queryFn: () => fetchJson("/api/engine/status", EngineSnapshotSchema),
    refetchInterval: opts.refetchInterval,
  });
}

export function useOAuthStatus() {
  return useQuery({
    queryKey: queryKeys.oauthStatus,
    queryFn: () => fetchJson("/api/oauth/status", OAuthStatusSchema),
  });
}

/**
 * Fault-injection flag state. Polled every 5s by the nav-bar pill — the only
 * caller that wants polling. Diagnostics page mounts its own poll-free copy
 * because it already runs an aggressive snapshot poll.
 */
export function useDebugFlags(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.debugFlags,
    queryFn: () => fetchJson("/api/debug/flags", DebugFlagsSchema),
    refetchInterval: opts.refetchInterval,
  });
}

export function useQuotaHistory(days: number) {
  return useQuery({
    queryKey: queryKeys.quotaHistory(days),
    queryFn: () => fetchJson(`/api/quota/history?days=${String(days)}`, QuotaHistorySchema),
  });
}

export function useRecentActivity(limit: number = 30) {
  return useQuery({
    queryKey: queryKeys.recentActivity(limit),
    queryFn: () => fetchJson(`/api/activity?limit=${String(limit)}`, RecentActivitySchema),
    refetchInterval: 30_000,
  });
}

interface ClipsListParams {
  page: number;
  pageSize: number;
  statusParam: string;
  totalStatuses: number;
  search: string;
  sortBy: string;
  sortOrder: string;
}

export function useClipsList(params: ClipsListParams) {
  const search = new URLSearchParams();
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  search.set("sortBy", params.sortBy);
  search.set("sortOrder", params.sortOrder);
  if (params.statusParam && params.statusParam.split(",").length < params.totalStatuses) {
    search.set("status", params.statusParam);
  }
  if (params.search) {
    search.set("search", params.search);
  }
  return useQuery({
    queryKey: queryKeys.clipsList({
      page: params.page,
      statusParam: params.statusParam,
      search: params.search,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
    queryFn: () => fetchJson(`/api/clips?${search.toString()}`, PaginatedClipsSchema),
  });
}

export function useClipDetail(clipId: string | null | undefined) {
  return useQuery({
    enabled: !!clipId,
    queryKey: queryKeys.clipDetail(clipId),
    queryFn: () => fetchJson(`/api/clips/${clipId ?? ""}`, ClipDetailSchema),
  });
}

interface LogsFilter {
  types: string[];
  totalTypes: number;
  clipId?: string;
  errorCode?: string;
  /** ISO timestamp lower bound, or null for unbounded. */
  since: string | null;
}

export function useLogsInfinite(filter: LogsFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.logs({
      types: filter.types.join(","),
      clipId: filter.clipId ?? "",
      errorCode: filter.errorCode ?? "",
      range: filter.since ?? "all",
    }),
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (filter.types.length > 0 && filter.types.length < filter.totalTypes) {
        sp.set("type", filter.types.join(","));
      }
      sp.set("limit", "50");
      if (typeof pageParam === "number") sp.set("before", String(pageParam));
      if (filter.clipId) sp.set("clipId", filter.clipId);
      if (filter.errorCode) sp.set("errorCode", filter.errorCode);
      if (filter.since) sp.set("since", filter.since);
      return fetchJson(`/api/logs?${sp.toString()}`, PaginatedLogsSchema);
    },
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.entries.length === 0) return null;
      return lastPage.entries.at(-1)?.id ?? null;
    },
  });
}
