import type { ReactNode } from "react";

interface Props {
  count: number;
  /**
   * Total count of rows matching the current filter set (across all pages).
   * If selected count equals page size and totalMatching > selected, we surface
   * a "Select all N matching" affordance.
   */
  totalMatching?: number;
  pageFullySelected?: boolean;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  actions: ReactNode;
}

/**
 * Sticky bottom action bar that appears when a non-zero selection exists in a
 * table. Pattern: Linear / GitHub / Vercel. Stays anchored to viewport bottom
 * so the user never loses access to bulk actions while scrolling.
 */
export function BulkActionBar({
  count,
  totalMatching,
  pageFullySelected,
  onSelectAllMatching,
  onClear,
  actions,
}: Props) {
  if (count === 0) return null;
  const canExpand =
    pageFullySelected &&
    onSelectAllMatching &&
    totalMatching !== undefined &&
    totalMatching > count;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex max-w-2xl flex-col items-center gap-1 rounded-lg border bg-white px-4 py-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {count.toLocaleString()} selected
          </span>
          <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
          <button
            type="button"
            onClick={onClear}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
        {canExpand && (
          <button
            type="button"
            onClick={onSelectAllMatching}
            className="text-xs text-blue-600 hover:underline dark:text-blue-300"
          >
            Select all {totalMatching.toLocaleString()} matching clips
          </button>
        )}
      </div>
    </div>
  );
}
