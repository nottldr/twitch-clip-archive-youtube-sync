import { useNavigate, useSearch } from "@tanstack/react-router";
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
import { useBulkClipAction, useRetryClip } from "#web/lib/mutations.js";
import { useClipsList, useStats } from "#web/lib/queries.js";

const ALL_STATUSES = ["pending", "uploading", "uploaded", "failed", "skipped", "ignored"] as const;

export function Queue() {
  const search = useSearch({ from: "/queue" });
  const navigate = useNavigate({ from: "/queue" });

  const [searchInput, setSearchInput] = useState(search.search);
  const [drawerClipId, setDrawerClipId] = useState<string | null>(null);

  const selection = useRowSelection();
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync URL changes (back/forward, deep link) back into the local input.
  useEffect(() => {
    setSearchInput(search.search);
  }, [search.search]);

  // Debounce: when the input differs from the URL, push to URL after 300ms.
  useEffect(() => {
    if (searchInput === search.search) return;
    const t = setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: searchInput, page: 1 }),
      });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [searchInput, search.search, navigate]);

  // `/` to focus search, Esc to clear selection / blur search. (j/k row nav
  // lives in useRowKeyboardNav below.) Stable ref pattern: the listener is
  // attached once and reads the latest state via refs, so we don't churn
  // window listeners on every selection toggle.
  const escStateRef = useRef({ selectionSize: 0, drawerClipId: null as string | null });
  escStateRef.current = { selectionSize: selection.size, drawerClipId };
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
        } else if (escStateRef.current.selectionSize > 0 && !escStateRef.current.drawerClipId) {
          selection.clear();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [selection]);

  const { data: stats } = useStats();

  // Status: array in URL, Set in component (for fast .has() in render).
  // `undefined` URL value means "all selected" — keeps the URL clean when at
  // the default ("show everything").
  const selectedStatuses = useMemo<Set<string>>(
    () => new Set(search.status ?? ALL_STATUSES),
    [search.status],
  );
  const statusParam = [...selectedStatuses].join(",");

  const { data, isLoading } = useClipsList({
    page: search.page,
    pageSize: 50,
    statusParam,
    totalStatuses: ALL_STATUSES.length,
    search: search.search,
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
  });

  const retryMutation = useRetryClip();
  const bulkMutation = useBulkClipAction();

  function toggleStatus(status: string) {
    const next = new Set(selectedStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    const arr = [...next].filter((s): s is (typeof ALL_STATUSES)[number] =>
      (ALL_STATUSES as readonly string[]).includes(s),
    );
    void navigate({
      search: (prev) => ({
        ...prev,
        status: arr.length === ALL_STATUSES.length ? undefined : arr,
        page: 1,
      }),
    });
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

  function runBulk(action: "retry" | "reset" | "ignore") {
    bulkMutation.mutate(
      { action, clipIds: [...selection.selected] },
      {
        onSuccess: () => {
          selection.clear();
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Queue" subtitle="Filter, search, and act on clips in bulk." />

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
            sortBy={search.sortBy}
            sortOrder={search.sortOrder}
            onSortChange={(by, order) => {
              void navigate({
                search: (prev) => ({
                  ...prev,
                  sortBy: toSortBy(by),
                  sortOrder: order,
                  page: 1,
                }),
              });
            }}
            onPageChange={(p) => {
              void navigate({ search: (prev) => ({ ...prev, page: p }) });
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
                runBulk("retry");
              }}
            />
            <BulkButton
              label="Reset"
              disabled={bulkMutation.isPending}
              onClick={() => {
                runBulk("reset");
              }}
            />
            <BulkButton
              label="Ignore"
              disabled={bulkMutation.isPending}
              onClick={() => {
                runBulk("ignore");
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

function toSortBy(value: string): "created_at" | "title" | "sync_status" | "retry_count" {
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
