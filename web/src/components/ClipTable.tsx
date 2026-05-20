import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type { ClipRow, PaginatedClips } from "#web/lib/types.js";

import { StatusBadge } from "./StatusBadge.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const columnHelper = createColumnHelper<ClipRow>();

function getColumns(opts: {
  onRetry: (clipId: string) => void;
  onView: (clipId: string) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (column: string) => void;
}) {
  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: (info) => (
        <button
          onClick={() => {
            opts.onView(info.row.original.clip_id);
          }}
          className="block max-w-[12rem] truncate text-left hover:text-blue-600 hover:underline sm:max-w-xs dark:hover:text-blue-300"
          title={info.getValue()}
        >
          {info.getValue()}
        </button>
      ),
    }),
    columnHelper.accessor("creator_name", {
      header: "Creator",
      meta: { hideBelow: "sm" },
    }),
    columnHelper.accessor("created_at", {
      header: "Date",
      cell: (info) => formatDate(info.getValue()),
      meta: { hideBelow: "md" },
    }),
    columnHelper.accessor("sync_status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor("retry_count", {
      header: "Retries",
      meta: { hideBelow: "md" },
      cell: (info) => {
        const n = info.getValue();
        if (n === 0) return <span className="text-gray-300">—</span>;
        return <span className="text-orange-600 dark:text-orange-300">{n}</span>;
      },
    }),
    columnHelper.accessor("last_error", {
      header: "Last error",
      enableSorting: false,
      meta: { hideBelow: "lg" },
      cell: (info) => {
        const err = info.getValue();
        if (!err) return <span className="text-gray-300">—</span>;
        return (
          <button
            onClick={() => {
              opts.onView(info.row.original.clip_id);
            }}
            className="block max-w-[14rem] truncate text-left font-mono text-xs text-red-600 hover:underline dark:text-red-300"
            title={err}
          >
            {err}
          </button>
        );
      },
    }),
    columnHelper.accessor("youtube_id", {
      header: "YouTube",
      enableSorting: false,
      meta: { hideBelow: "sm" },
      cell: (info) => {
        const id = info.getValue();
        return id ? (
          <a
            href={`https://youtu.be/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="text-blue-500 hover:underline"
          >
            {id}
          </a>
        ) : (
          <span className="text-gray-300">-</span>
        );
      },
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: (info) => {
        const status = info.row.original.sync_status;
        return (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => {
                opts.onView(info.row.original.clip_id);
              }}
              className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              title="View details"
            >
              Detail
            </button>
            {status !== "pending" && status !== "uploading" && status !== "ignored" && (
              <button
                onClick={() => {
                  opts.onRetry(info.row.original.clip_id);
                }}
                className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                title="Retry from scratch"
              >
                Retry
              </button>
            )}
          </div>
        );
      },
    }),
  ];
}

const HIDE_CLASSES: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const SORTABLE_COLUMNS = new Set(["title", "created_at", "sync_status", "retry_count"]);

export function ClipTable({
  data,
  sortBy,
  sortOrder,
  onSortChange,
  onPageChange,
  onRetry,
  onView,
}: {
  data: PaginatedClips;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (sortBy: string, sortOrder: "asc" | "desc") => void;
  onPageChange: (page: number) => void;
  onRetry: (clipId: string) => void;
  onView: (clipId: string) => void;
}) {
  const handleSort = (column: string) => {
    if (!SORTABLE_COLUMNS.has(column)) return;
    if (column === sortBy) {
      onSortChange(column, sortOrder === "asc" ? "desc" : "asc");
    } else {
      onSortChange(column, "asc");
    }
  };

  const columns = getColumns({ onRetry, onView, sortBy, sortOrder, onSort: handleSort });

  const table = useReactTable({
    data: data.clips,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b text-left text-gray-500 dark:border-gray-700 dark:text-gray-400"
              >
                {headerGroup.headers.map((header) => {
                  const hideBelow = header.column.columnDef.meta?.hideBelow;
                  const hideCls = hideBelow ? HIDE_CLASSES[hideBelow] : "";
                  const colId = header.column.id;
                  const isSortable = SORTABLE_COLUMNS.has(colId);

                  return (
                    <th
                      key={header.id}
                      className={`px-3 py-2 ${hideCls} ${isSortable ? "cursor-pointer select-none" : ""}`}
                      onClick={
                        isSortable
                          ? () => {
                              handleSort(colId);
                            }
                          : undefined
                      }
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortBy === colId ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                {row.getVisibleCells().map((cell) => {
                  const hideBelow = cell.column.columnDef.meta?.hideBelow;
                  const hideCls = hideBelow ? HIDE_CLASSES[hideBelow] : "";

                  return (
                    <td key={cell.id} className={`px-3 py-2 ${hideCls}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between px-3 text-sm text-gray-600 dark:text-gray-300">
          <span>
            {data.page}/{data.totalPages} ({data.total})
          </span>
          <div className="flex gap-2">
            <button
              disabled={data.page <= 1}
              onClick={() => {
                onPageChange(data.page - 1);
              }}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              Prev
            </button>
            <button
              disabled={data.page >= data.totalPages}
              onClick={() => {
                onPageChange(data.page + 1);
              }}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Extend TanStack Table's column meta type
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    hideBelow?: "sm" | "md" | "lg";
  }
}
