import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ClipDetailDrawer } from "#web/components/ClipDetailDrawer.js";
import { ClipTable } from "#web/components/ClipTable.js";
import { fetchJson } from "#web/lib/api.js";
import { DashboardStatsSchema, PaginatedClipsSchema } from "#web/lib/types.js";

const ALL_STATUSES = ["pending", "uploading", "uploaded", "failed", "skipped", "ignored"] as const;

type SortBy = "created_at" | "title" | "sync_status" | "retry_count";
type SortOrder = "asc" | "desc";

export function Clips() {
  const [page, setPage] = useState(1);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [drawerClipId, setDrawerClipId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Debounce search input so typing doesn't hammer the API every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [searchInput]);

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const statusParam = [...selectedStatuses].join(",");

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", "50");
  params.set("sortBy", sortBy);
  params.set("sortOrder", sortOrder);
  if (statusParam && selectedStatuses.size < ALL_STATUSES.length) {
    params.set("status", statusParam);
  }
  if (search) {
    params.set("search", search);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["clips", page, statusParam, search, sortBy, sortOrder],
    queryFn: () => fetchJson(`/api/clips?${params.toString()}`, PaginatedClipsSchema),
  });

  const retryMutation = useMutation({
    mutationFn: async (clipId: string) => {
      const res = await fetch(`/api/clips/${clipId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(`Retry failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  function toggleStatus(status: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
    setPage(1);
  }

  function handleCopyLinks() {
    if (!data) return;
    const links = data.clips
      .filter((c) => c.youtube_id)
      .map((c) => `https://youtu.be/${c.youtube_id ?? ""}`)
      .join("\n");
    void navigator.clipboard.writeText(links);
  }

  /**
   * Server-side CSV export. Honors current filters (status + search) and
   * returns every matching row — not just the current page like the old
   * client-side export.
   */
  function handleExportCsv() {
    const exportParams = new URLSearchParams();
    if (statusParam && selectedStatuses.size < ALL_STATUSES.length) {
      exportParams.set("status", statusParam);
    }
    if (search) exportParams.set("search", search);
    const url = `/api/clips/export?${exportParams.toString()}`;
    // Use a hidden anchor so the browser handles the Content-Disposition download.
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    a.click();
  }

  const statusCounts: Record<string, number> = stats
    ? {
        pending: stats.clips.pending,
        uploading: stats.clips.uploading,
        uploaded: stats.clips.uploaded,
        failed: stats.clips.failed,
        skipped: stats.clips.skipped,
        ignored: stats.clips.ignored,
      }
    : {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Clips</h1>
        <div className="flex gap-2">
          <button
            onClick={handleCopyLinks}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            Copy Links
          </button>
          <button
            onClick={handleExportCsv}
            title="Export every matching clip (not just this page)"
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Status checkboxes */}
      <div className="flex flex-wrap items-center gap-3">
        {ALL_STATUSES.map((status) => (
          <label key={status} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selectedStatuses.has(status)}
              onChange={() => {
                toggleStatus(status);
              }}
              className="rounded"
            />
            <span className="capitalize">{status}</span>
            {statusCounts[status] !== undefined && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({statusCounts[status].toLocaleString()})
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
          }}
          placeholder="Search clip ID, title, creator..."
          className="w-40 rounded border px-2 py-1 text-sm sm:w-64 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        {searchInput && (
          <button
            onClick={() => {
              setSearchInput("");
            }}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      <div className="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        {isLoading && !data ? (
          <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>
        ) : data ? (
          <ClipTable
            data={data}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={(by, order) => {
              // eslint-disable-next-line typescript/no-unsafe-type-assertion -- column ids are constrained to SortBy
              setSortBy(by as SortBy);
              setSortOrder(order);
              setPage(1);
            }}
            onPageChange={(p) => {
              setPage(p);
            }}
            onRetry={(clipId) => {
              retryMutation.mutate(clipId);
            }}
            onView={(clipId) => {
              setDrawerClipId(clipId);
            }}
          />
        ) : null}
      </div>

      <ClipDetailDrawer
        clipId={drawerClipId}
        onClose={() => {
          setDrawerClipId(null);
        }}
      />
    </div>
  );
}
