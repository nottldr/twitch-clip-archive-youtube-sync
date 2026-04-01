import type { SortingState } from "@tanstack/react-table";

import { useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

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

function getColumns(onReset: (clipId: string) => void) {
  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: (info) => (
        <span className="block max-w-[12rem] truncate sm:max-w-xs" title={info.getValue()}>
          {info.getValue()}
        </span>
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
        if (status === "pending") return null;
        return (
          <button
            onClick={() => {
              onReset(info.row.original.clip_id);
            }}
            className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title="Reset to pending"
          >
            Reset
          </button>
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

export function ClipTable({
  data,
  onPageChange,
}: {
  data: PaginatedClips;
  onPageChange: (page: number) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const queryClient = useQueryClient();

  const handleReset = (clipId: string) => {
    void fetch(`/api/clips/${clipId}/reset`, { method: "POST" }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["clips"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    });
  };

  const columns = getColumns(handleReset);

  const table = useReactTable({
    data: data.clips,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b text-left text-gray-500">
                {headerGroup.headers.map((header) => {
                  const hideBelow = header.column.columnDef.meta?.hideBelow;
                  const hideCls = hideBelow ? HIDE_CLASSES[hideBelow] : "";

                  return (
                    <th
                      key={header.id}
                      className={`px-3 py-2 ${hideCls} ${header.column.getCanSort() ? "cursor-pointer select-none" : ""}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc"
                          ? " ↑"
                          : header.column.getIsSorted() === "desc"
                            ? " ↓"
                            : ""}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b hover:bg-gray-50">
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
        <div className="mt-4 flex items-center justify-between px-3 text-sm text-gray-600">
          <span>
            {data.page}/{data.totalPages} ({data.total})
          </span>
          <div className="flex gap-2">
            <button
              disabled={data.page <= 1}
              onClick={() => {
                onPageChange(data.page - 1);
              }}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              disabled={data.page >= data.totalPages}
              onClick={() => {
                onPageChange(data.page + 1);
              }}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-30"
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
