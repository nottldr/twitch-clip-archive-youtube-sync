import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ClipTable } from "#web/components/ClipTable.js";
import { fetchJson } from "#web/lib/api.js";
import { DashboardStatsSchema, PaginatedClipsSchema } from "#web/lib/types.js";

const ALL_STATUSES = ["pending", "uploading", "uploaded", "failed", "skipped", "ignored"] as const;

export function Clips() {
  const [page, setPage] = useState(1);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson("/api/stats", DashboardStatsSchema),
  });

  const statusParam = [...selectedStatuses].join(",");

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", "50");
  if (statusParam && selectedStatuses.size < ALL_STATUSES.length) {
    params.set("status", statusParam);
  }
  if (search) {
    params.set("search", search);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["clips", page, statusParam, search],
    queryFn: () => fetchJson(`/api/clips?${params}`, PaginatedClipsSchema),
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
      .map((c) => `https://youtu.be/${c.youtube_id}`)
      .join("\n");
    void navigator.clipboard.writeText(links);
  }

  function handleExportCsv() {
    if (!data) return;
    const header = "clip_id,title,youtube_url,uploaded_at";
    const rows = data.clips
      .filter((c) => c.youtube_id)
      .map(
        (c) =>
          `"${c.clip_id}","${c.title.replaceAll('"', '""')}","https://youtu.be/${c.youtube_id}","${c.uploaded_at ?? ""}"`,
      );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clips-export.csv";
    a.click();
    URL.revokeObjectURL(url);
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput);
          setPage(1);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
          }}
          placeholder="Search..."
          className="w-40 rounded border px-2 py-1 text-sm sm:w-64 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <button
          type="submit"
          className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
        >
          Search
        </button>
      </form>

      <div className="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        {isLoading && !data ? (
          <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>
        ) : data ? (
          <ClipTable
            data={data}
            onPageChange={(p) => {
              setPage(p);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
