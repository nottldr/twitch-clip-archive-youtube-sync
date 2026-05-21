import { useEffect } from "react";

interface Options {
  /** IDs of the currently-visible rows, in order. */
  rowIds: readonly string[];
  /** The currently-active row id (open in the drawer), or null. */
  activeId: string | null;
  /** Move the active row. Null clears focus. */
  onChange: (next: string | null) => void;
}

/**
 * `j` / `k` row navigation that follows the drawer. When the drawer is open,
 * `j` moves to the next row (cycling to start at the end) and `k` to the
 * previous (cycling to end at the start). `Escape` closes the drawer when
 * one is open. Skips when focus is inside an editable element so it doesn't
 * eat typing in the search input.
 */
export function useRowKeyboardNav({ rowIds, activeId, onChange }: Options) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (inField) return;
      if (rowIds.length === 0) return;

      if (e.key === "j" || e.key === "k") {
        if (!activeId) return;
        const idx = rowIds.indexOf(activeId);
        if (idx === -1) return;
        const nextIdx =
          e.key === "j" ? (idx + 1) % rowIds.length : (idx - 1 + rowIds.length) % rowIds.length;
        e.preventDefault();
        onChange(rowIds[nextIdx]);
      } else if (e.key === "Escape" && activeId) {
        e.preventDefault();
        onChange(null);
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [rowIds, activeId, onChange]);
}
