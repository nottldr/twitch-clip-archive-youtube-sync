import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ClipTable } from "#web/components/ClipTable.js";
import { fetchJson } from "#web/lib/api.js";
import { PaginatedClipsSchema } from "#web/lib/types.js";

export function Clips() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", "50");
  if (status !== "all") params.set("status", status);
  if (search) params.set("search", search);

  const { data, isLoading } = useQuery({
    queryKey: ["clips", page, status, search],
    queryFn: () => fetchJson(`/api/clips?${params}`, PaginatedClipsSchema),
  });

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Clips</h1>
        <div className="flex gap-2">
          <button
            onClick={handleCopyLinks}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
          >
            Copy Links
          </button>
          <button
            onClick={handleExportCsv}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="uploaded">Uploaded</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>

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
            className="w-40 rounded border px-2 py-1 text-sm sm:w-64"
          />
          <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
            Search
          </button>
        </form>
      </div>

      <div className="rounded-lg bg-white shadow-sm">
        {isLoading && !data ? (
          <div className="p-8 text-gray-400">Loading...</div>
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
