import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ClipDetailDrawer } from "#web/components/ClipDetailDrawer.js";
import { ClipTable } from "#web/components/ClipTable.js";
import { BulkActionBar } from "#web/components/ui/BulkActionBar.js";
import { FilterChips } from "#web/components/ui/FilterChips.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton } from "#web/components/ui/Skeleton.js";
import { Toolbar } from "#web/components/ui/Toolbar.js";
import { useRowKeyboardNav } from "#web/hooks/use-row-keyboard-nav.js";
import { useRowSelection } from "#web/hooks/use-row-selection.js";
import { fetchJson } from "#web/lib/api.js";
import { useToast } from "#web/lib/toast.js";
import { DashboardStatsSchema, PaginatedClipsSchema } from "#web/lib/types.js";

const ALL_STATUSES = ["pending", "uploading", "uploaded", "failed", "skipped", "ignored"] as const;

type SortBy = "created_at" | "title" | "sync_status" | "retry_count";
type SortOrder = "asc" | "desc";
type BulkAction = "retry" | "reset" | "ignore";

function toSortBy(value: string): SortBy {
  switch (value) {
    case "title":
    case "sync_status":
    case "retry_count":
    case "created_at":
      return value;
    default:
      return "created_at";
  }
}

export function Queue() {
  const [page, setPage] = useState(1);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [drawerClipId, setDrawerClipId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { notify } = useToast();
  const selection = useRowSelection();
  const searchRef = useRef<HTMLInputElement>(null);

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

  // `/` to focus search, Esc to clear selection / blur search. (j/k row nav
  // lives in useRowKeyboardNav below.)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (searchRef.current && document.activeElement === searchRef.current) {
          searchRef.current.blur();
        } else if (selection.size > 0 && !drawerClipId) {
          selection.clear();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [selection, drawerClipId]);

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

  const bulkMutation = useMutation({
    mutationFn: async (input: { action: BulkAction; clipIds: string[] }) => {
      const res = await fetch("/api/clips/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Bulk ${input.action} failed: ${res.status}`);
      const body: unknown = await res.json();
      const affected =
        typeof body === "object" &&
        body !== null &&
        "affected" in body &&
        typeof body.affected === "number"
          ? body.affected
          : 0;
      return { affected };
    },
    onSuccess: (result, input) => {
      notify(
        "success",
        `${input.action === "ignore" ? "Ignored" : input.action === "retry" ? "Retried" : "Reset"} ${result.affected.toLocaleString()} clip${result.affected === 1 ? "" : "s"}`,
      );
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Bulk action failed");
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
    notify("info", "YouTube links copied to clipboard");
  }

  function handleExportCsv() {
    const exportParams = new URLSearchParams();
    if (statusParam && selectedStatuses.size < ALL_STATUSES.length) {
      exportParams.set("status", statusParam);
    }
    if (search) exportParams.set("search", search);
    const url = `/api/clips/export?${exportParams.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    a.click();
  }

  const filterOptions = useMemo(
    () =>
      ALL_STATUSES.map((s) => ({
        value: s,
        label: s,
        count: stats?.clips[s],
      })),
    [stats],
  );

  // Page-scoped selection bookkeeping for the header checkbox state.
  const pageClipIds = data?.clips.map((c) => c.clip_id) ?? [];
  const pageAllSelected =
    pageClipIds.length > 0 && pageClipIds.every((id) => selection.isSelected(id));
  const pageSomeSelected = pageClipIds.some((id) => selection.isSelected(id));

  // j / k advance the open drawer through the visible rows. Killer feature
  // for triaging failures: open one, then press j repeatedly to walk down.
  useRowKeyboardNav({
    rowIds: pageClipIds,
    activeId: drawerClipId,
    onChange: setDrawerClipId,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Queue"
        subtitle="Filter, search, and act on clips in bulk."
        actions={
          <>
            <button
              onClick={handleCopyLinks}
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              Copy links
            </button>
            <button
              onClick={handleExportCsv}
              title="Export every matching clip (not just this page)"
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              Export CSV
            </button>
          </>
        }
      />

      <Toolbar
        start={
          <>
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                }}
                placeholder="Search clip ID, title…  ( / )"
                className="w-44 rounded border px-2 py-1 text-sm sm:w-72 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput("");
                  }}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  ✕
                </button>
              )}
            </div>
            <FilterChips
              options={filterOptions}
              selected={selectedStatuses}
              onToggle={toggleStatus}
            />
          </>
        }
      />

      <div className="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        {isLoading && !data ? (
          <div className="p-4">
            <Skeleton className="h-4 w-1/3" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ) : data ? (
          <ClipTable
            data={data}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={(by, order) => {
              setSortBy(toSortBy(by));
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
            selection={{
              isSelected: selection.isSelected,
              toggle: selection.toggle,
              selectAllOnPage: () => {
                selection.selectAllOnPage(pageClipIds);
              },
              pageAllSelected,
              pageSomeSelected,
            }}
          />
        ) : null}
      </div>

      <BulkActionBar
        count={selection.size}
        totalMatching={data?.total}
        pageFullySelected={pageAllSelected}
        onClear={selection.clear}
        actions={
          <>
            <BulkButton
              label="Retry"
              disabled={bulkMutation.isPending}
              onClick={() => {
                bulkMutation.mutate({ action: "retry", clipIds: [...selection.selected] });
              }}
            />
            <BulkButton
              label="Reset"
              disabled={bulkMutation.isPending}
              onClick={() => {
                bulkMutation.mutate({ action: "reset", clipIds: [...selection.selected] });
              }}
            />
            <BulkButton
              label="Ignore"
              disabled={bulkMutation.isPending}
              onClick={() => {
                bulkMutation.mutate({ action: "ignore", clipIds: [...selection.selected] });
              }}
            />
          </>
        }
      />

      <ClipDetailDrawer
        clipId={drawerClipId}
        onClose={() => {
          setDrawerClipId(null);
        }}
      />
    </div>
  );
}

function BulkButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
    >
      {label}
    </button>
  );
}
